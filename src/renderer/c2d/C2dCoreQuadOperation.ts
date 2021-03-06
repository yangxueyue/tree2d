import { CoreQuadOperation } from "../../tree/core/CoreQuadOperation";
import { C2dCoreQuadList } from "./C2dCoreQuadList";
import { C2dShader } from "./C2dShader";

export class C2dCoreQuadOperation extends CoreQuadOperation {
    get quadList(): C2dCoreQuadList {
        return super.quadList as C2dCoreQuadList;
    }

    getC2dShader(): C2dShader {
        return this.shader as C2dShader;
    }

    getRenderContext(index: number) {
        return this.quadList.getRenderContext(this.index + index);
    }

    getSimpleTc(index: number) {
        return this.quadList.getSimpleTc(this.index + index);
    }

    getWhite(index: number) {
        return this.quadList.getWhite(this.index + index);
    }
}
