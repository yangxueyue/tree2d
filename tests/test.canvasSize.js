// These tests must be performed separately from HTML because we want it to behave differently (more consistently) than HTML.
describe("canvas size", () => {
    let stage, root, element;
    before(() => {
        const canvas = document.createElement("canvas");
        canvas.style.width = "900px";
        canvas.style.height = "900px";
        stage = new tree2d.Stage(canvas, { clearColor: 0xffff0000, autostart: false, pixelRatio: 1 });
        root = stage.root;
        document.body.appendChild(stage.getCanvas());
    });

    before(() => {
        root.funcW = (w) => w;
        root.funcH = (h) => h;
        element = stage.createElement({
            funcW: (w) => w * 0.5,
            funcH: (h) => h,
            clipping: true,
            children: {
                Item: {
                    x: 400,
                    texture: {type: tree2d.ImageTexture, src: "./example.png"},
                },
            },
        });
        root.children = [element];

        stage.drawFrame();
    });

    describe("initial", () => {
        it("root width and height should be 100%", () => {
            chai.assert(Math.round(root.layoutW) === 900, "width should be 100%");
            chai.assert(Math.round(root.layoutH) === 900, "height should be 100%");
        });

        it("element width and height should be relative", () => {
            chai.assert(Math.round(element.layoutW) === 450, "width should be 50%");
            chai.assert(Math.round(element.layoutH) === 900, "height should be 100%");
        });

        it("clipped element should have correct active flag", () => {
            const item = element.getByRef("Item");
            chai.assert(item.active, "item should be active");
        });
    });

    describe("change", () => {
        before(() => {
            stage.getCanvas().style.width = "300px";
            stage.getCanvas().style.height = "300px";
            stage.drawFrame();
        });

        it("root width and height should be 100%", () => {
            chai.assert(root.layoutW === 300, "width should be 100%");
            chai.assert(root.layoutH === 300, "height should be 100%");
        });

        it("element width and height should be relative", () => {
            chai.assert(element.layoutW === 150, "width should be 50%");
            chai.assert(element.layoutH === 300, "height should be 100%");
        });

        it("clipped element should have correct active flag", () => {
            const item = element.getByRef("Item");
            chai.assert(!item.active, "item should not be active");
        });
    });
});
