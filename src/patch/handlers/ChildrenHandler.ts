import Handler from "./Handler";
import { ChildList } from "./ChildList";

export default class ChildrenHandler extends Handler {
    handle(obj: any, settings: any): any {
        const childList = new ChildList(obj);
        childList.patch(settings);
    }
}
