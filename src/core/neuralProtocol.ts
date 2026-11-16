export interface NeuralRequest {
  id: number;
  file: string;
  input: string;
  data: Float32Array;
  dimensions: number[];
}

export interface NeuralReply {
  id: number;
  logits?: Float32Array;
}
