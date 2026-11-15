"""Train the CueKoda drop and breakdown models (offline, requires NumPy and scikit-learn)."""
import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier


def train(features, targets):
    positive_weight = np.sqrt(len(targets) / np.sum(targets))
    weights = np.where(targets == 1, positive_weight, 1.0)
    classifier = HistGradientBoostingClassifier(
        max_iter=140,
        max_depth=3,
        learning_rate=0.08,
        l2_regularization=2,
        min_samples_leaf=15,
        random_state=12,
    )
    classifier.fit(features, targets, sample_weight=weights)
    trees = []
    # Export scalar leaves and numeric splits from the pinned sklearn version.
    for (tree,) in classifier._predictors:
        nodes = []
        for node in tree.nodes:
            if node["is_leaf"]:
                nodes.append([round(float(node["value"]), 9)])
            else:
                nodes.append([
                    int(node["feature_idx"]),
                    round(float(node["num_threshold"]), 10),
                    int(node["left"]),
                    int(node["right"]),
                ])
        trees.append(nodes)
    return {"intercept": round(float(classifier._baseline_prediction[0, 0]), 9), "trees": trees}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("features", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    with args.features.open(encoding="utf-8") as file:
        records = [json.loads(line) for line in file if line.strip()]
    models = {}
    for label in ("drop", "breakdown"):
        rows = [record for record in records if record["type"] == label]
        values = [row["target"] for row in rows]
        if set(values) != {0, 1}:
            parser.error(f"{label} requires both landmark and background examples")
        features = np.asarray([row["features"] for row in rows])
        models[label] = train(features, np.asarray(values))
    with args.output.open("w", encoding="utf-8") as file:
        file.write("{\n")
        for index, (label, model) in enumerate(models.items()):
            file.write(f'  "{label}": {{\n    "intercept": {model["intercept"]},\n    "trees": [\n')
            file.write(",\n".join("      " + json.dumps(tree, separators=(",", ": ")) for tree in model["trees"]))
            file.write("\n    ]\n  }" + ("," if index + 1 < len(models) else "") + "\n")
        file.write("}\n")


if __name__ == "__main__":
    main()
