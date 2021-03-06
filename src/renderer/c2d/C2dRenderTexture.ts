import { RenderTexture } from "../RenderTexture";

export interface C2dRenderTexture extends RenderTexture, HTMLCanvasElement {
    context: CanvasRenderingContext2DWithInfo;
}

type CanvasRenderingContext2DWithInfo = CanvasRenderingContext2D & { scissor?: number[] };
