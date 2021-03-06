import { Shader } from "../../tree/Shader";
import { C2dCoreQuadOperation } from "./C2dCoreQuadOperation";
import { C2dRenderTexture } from "./C2dRenderTexture";

export class C2dShader extends Shader {
    beforeDraw(operation: C2dCoreQuadOperation, target: C2dRenderTexture) {
        // Noop
    }

    draw(operation: C2dCoreQuadOperation, target: C2dRenderTexture) {
        // Noop
    }

    afterDraw(operation: C2dCoreQuadOperation, target: C2dRenderTexture) {
        // Noop
    }
}
