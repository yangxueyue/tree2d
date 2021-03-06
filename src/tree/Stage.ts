/**
 * Application render tree.
 * Copyright Metrological, 2017
 * Copyright Bas van Meurs, 2020
 */

import { Patcher } from "../patch";
import { WebGLRenderer } from "../renderer/webgl/WebGLRenderer";
import { C2dRenderer } from "../renderer/c2d/C2dRenderer";
import { Element } from "./Element";
import { ColorUtils } from "./ColorUtils";
import { TextureManager } from "./TextureManager";
import { CoreContext } from "./core/CoreContext";
import { RectangleTexture } from "../textures";
import { WebPlatform } from "../platforms/browser/WebPlatform";
import { Renderer } from "../renderer/Renderer";
import { Texture } from "./Texture";
import { ElementCoordinatesInfo } from "./core/ElementCore";
import { StageOptions } from "./StageOptions";

export class Stage {
    private destroyed = false;

    public readonly gpuPixelsMemory: number;
    public readonly bufferMemory: number;
    public readonly defaultFontFace: string[];
    public readonly fixedTimestep: number;
    public readonly useImageWorker: boolean;
    public readonly autostart: boolean;
    public readonly pixelRatio: number;
    public readonly canvas2d: boolean;

    private _usedMemory: number = 0;
    private _lastGcFrame: number = 0;
    public readonly platform: WebPlatform = new WebPlatform(this);

    public readonly gl: WebGLRenderingContext;
    public readonly c2d: CanvasRenderingContext2D;

    private _renderer: Renderer;

    public readonly textureManager: TextureManager;

    public frameCounter: number = 0;
    private startTime: number = 0;
    private currentTime: number = 0;
    private dt: number = 0;

    public readonly rectangleTexture: RectangleTexture;
    public readonly context: CoreContext;

    private _updateTextures = new Set<Texture>();

    public readonly root: Element;

    private _updatingFrame = false;
    private clearColor: null | number[] = null;

    private onFrameStart?: () => void;
    private onUpdate?: () => void;
    private onFrameEnd?: () => void;
    private canvasWidth: number = -1;
    private canvasHeight: number = -1;
    private idsMap = new Map<string, Element[]>();

    constructor(public readonly canvas: HTMLCanvasElement, options: Partial<StageOptions> = {}) {
        this.gpuPixelsMemory = options.gpuPixelsMemory || 32e6;
        this.bufferMemory = options.bufferMemory || 16e6;
        this.defaultFontFace = options.defaultFontFace || ["sans-serif"];
        this.fixedTimestep = options.fixedTimestep || 0;
        this.useImageWorker = options.useImageWorker === undefined || options.useImageWorker;
        this.autostart = options.autostart !== false;
        this.pixelRatio = options.pixelRatio || this.getDefaultPixelRatio() || 1;
        this.canvas2d = options.canvas2d === true || !Stage.isWebglSupported();

        this.destroyed = false;

        this._usedMemory = 0;
        this._lastGcFrame = 0;

        this.platform.init();

        if (this.canvas2d) {
            console.log("Using canvas2d renderer");
            this.c2d = this.platform.createCanvasContext();
            this.gl = undefined as any;
            this._renderer = new C2dRenderer(this) as any;
        } else {
            this.gl = this.platform.createWebGLContext();
            this.c2d = undefined as any;
            this._renderer = new WebGLRenderer(this);
        }

        this.frameCounter = 0;

        this.textureManager = new TextureManager(this);

        // Preload rectangle texture.
        this.rectangleTexture = new RectangleTexture(this);

        this.context = new CoreContext(this);

        this.root = new Element(this);
        this.root.setAsRoot();

        this.context.root = this.root.core;

        this.processClearColorOption(options.clearColor);

        this.checkCanvasDimensions();

        if (this.autostart) {
            this.platform.startLoop();
        }
    }

    private processClearColorOption(option: number | string | null | undefined) {
        switch (option) {
            case null:
                this.setClearColor(null);
                break;
            case undefined:
                this.setClearColor([0, 0, 0, 0]);
                break;
            default:
                this.setClearColor(ColorUtils.getRgbaComponentsNormalized(ColorUtils.getArgbFromAny(option)));
        }
    }

    get w() {
        return this.canvas.width;
    }

    get h() {
        return this.canvas.height;
    }

    get renderer() {
        return this._renderer;
    }

    static isWebglSupported() {
        try {
            return !!window.WebGLRenderingContext;
        } catch (e) {
            return false;
        }
    }

    destroy() {
        this.destroyed = true;
        this.platform.stopLoop();
        this.platform.destroy();
        this.context.destroy();
        this.textureManager.destroy();
        this._renderer.destroy();
    }

    stop() {
        this.platform.stopLoop();
    }

    resume() {
        this.platform.startLoop();
    }

    getCanvas() {
        return this.canvas;
    }

    getPixelRatio() {
        return this.pixelRatio;
    }

    // Marks a texture for updating it's source upon the next drawFrame.
    addUpdateTexture(texture: Texture) {
        if (this._updatingFrame) {
            // When called from the upload loop, we must immediately load the texture in order to avoid a 'flash'.
            texture._performUpdateSource();
        } else {
            this._updateTextures.add(texture);
        }
    }

    removeUpdateTexture(texture: Texture) {
        if (this._updateTextures) {
            this._updateTextures.delete(texture);
        }
    }

    hasUpdateTexture(texture: Texture) {
        return this._updateTextures && this._updateTextures.has(texture);
    }

    drawFrame() {
        this.checkCanvasDimensions();

        this.startTime = this.currentTime;
        this.currentTime = this.platform.getHrTime();

        if (this.fixedTimestep) {
            this.dt = this.fixedTimestep;
        } else {
            this.dt = !this.startTime ? 0.02 : 0.001 * (this.currentTime - this.startTime);
        }

        if (this.onFrameStart) {
            this.onFrameStart();
        }

        if (this._updateTextures.size) {
            this._updateTextures.forEach((texture) => {
                texture._performUpdateSource();
            });
            this._updateTextures = new Set();
        }

        if (this.onUpdate) {
            this.onUpdate();
        }

        const changes = this.context.hasRenderUpdates();

        if (changes) {
            this._updatingFrame = true;
            this.context.update();
            this.context.render();
            this._updatingFrame = false;
        }

        this.platform.nextFrame(changes);

        if (this.onFrameEnd) {
            this.onFrameEnd();
        }

        this.frameCounter++;
    }

    isUpdatingFrame() {
        return this._updatingFrame;
    }

    forceRenderUpdate() {
        this.context.setRenderUpdatesFlag();
    }

    setClearColor(clearColor: number[] | null) {
        if (clearColor === null) {
            // Do not clear.
            this.clearColor = null;
        } else {
            this.clearColor = clearColor;
        }
        this.forceRenderUpdate();
    }

    getClearColor() {
        return this.clearColor;
    }

    createElement(settings: any) {
        return Patcher.createObject(settings, Element, this);
    }

    createShader(settings: any) {
        return Patcher.createObject(settings, undefined, this);
    }

    get coordsWidth() {
        return this.canvasWidth / this.pixelRatio;
    }

    get coordsHeight() {
        return this.canvasHeight / this.pixelRatio;
    }

    addMemoryUsage(delta: number) {
        this._usedMemory += delta;
        if (this._lastGcFrame !== this.frameCounter) {
            if (this._usedMemory > this.gpuPixelsMemory) {
                this.gc(false);
                if (this._usedMemory > this.gpuPixelsMemory - 2e6) {
                    // Too little memory could be recovered. Aggressive cleanup.
                    this.gc(true);
                }
            }
        }
    }

    get usedMemory() {
        return this._usedMemory;
    }

    gc(aggressive: boolean) {
        if (this._lastGcFrame !== this.frameCounter) {
            this._lastGcFrame = this.frameCounter;
            const memoryUsageBefore = this._usedMemory;
            this.gcTextureMemory(aggressive);
            this.gcRenderTextureMemory(aggressive);
            this.renderer.gc(aggressive);

            console.log(
                `GC${aggressive ? "[aggressive]" : ""}! Frame ${this._lastGcFrame} Freed ${(
                    (memoryUsageBefore - this._usedMemory) /
                    1e6
                ).toFixed(2)}MP from GPU memory. Remaining: ${(this._usedMemory / 1e6).toFixed(2)}MP`,
            );
            const other = this._usedMemory - this.textureManager.usedMemory - this.context.usedMemory;
            console.log(
                ` Textures: ${(this.textureManager.usedMemory / 1e6).toFixed(2)}MP, Render Textures: ${(
                    this.context.usedMemory / 1e6
                ).toFixed(2)}MP, Renderer caches: ${(other / 1e6).toFixed(2)}MP`,
            );
        }
    }

    gcTextureMemory(aggressive = false) {
        if (aggressive && this.root.visible) {
            // Make sure that ALL textures are cleaned;
            this.root.visible = false;
            this.textureManager.gc();
            this.root.visible = true;
        } else {
            this.textureManager.gc();
        }
    }

    gcRenderTextureMemory(aggressive = false) {
        if (aggressive && this.root.visible) {
            // Make sure that ALL render textures are cleaned;
            this.root.visible = false;
            this.context.freeUnusedRenderTextures(0);
            this.root.visible = true;
        } else {
            this.context.freeUnusedRenderTextures(0);
        }
    }

    getDrawingCanvas() {
        return this.platform.getDrawingCanvas();
    }

    update() {
        this.context.update();
    }

    isDestroyed() {
        return this.destroyed;
    }

    private checkCanvasDimensions() {
        const rect = this.canvas.getBoundingClientRect();

        let changed = false;

        // Prevent resize recursion in dynamic layouts (flexbox etc).
        // Notice that when you would like to use dynamic resize, you should wrap the canvas element in a dynamically
        // resized div, and absolutely position the canvas in it with 100% width and height.
        const cssWidth = rect.width || this.canvas.width;
        if (Math.round(cssWidth) !== Math.round(this.canvasWidth)) {
            const newCanvasWidth = cssWidth * this.pixelRatio;
            changed = changed || newCanvasWidth !== this.canvasWidth;
            this.canvasWidth = newCanvasWidth;
        }

        const cssHeight = rect.height || this.canvas.height;
        if (Math.round(cssHeight) !== Math.round(this.canvasHeight)) {
            const newCanvasHeight = cssHeight * this.pixelRatio;
            changed = changed || newCanvasHeight !== this.canvasHeight;
            this.canvasHeight = newCanvasHeight;
        }

        if (changed) {
            this.updateCanvasSize();
        }
    }

    private updateCanvasSize() {
        // Make sure that the canvas looks 'crisp'.
        this.canvas.width = Math.round(this.canvasWidth);
        this.canvas.height = Math.round(this.canvasHeight);

        // Reset dimensions.
        this.root.core.setupAsRoot();
        this.renderer.onResizeCanvasSize();
    }

    getElementsAtCoordinates<DATA = any>(worldX: number, worldY: number): ElementCoordinatesInfo<DATA>[] {
        const results: ElementCoordinatesInfo[] = [];
        this.root.core.update();
        this.root.core.gatherElementsAtCoordinates(worldX, worldY, results);
        return results.reverse();
    }

    private getDefaultPixelRatio() {
        // Fractional pixel ratios (except for 1.5) might produce artifacts so we skip them by default.
        if (window.devicePixelRatio >= 2) {
            return 2;
        } else if (window.devicePixelRatio > 1) {
            return 1.5;
        } else {
            return 1;
        }
    }

    addId(id: string, element: Element) {
        let elements = this.idsMap.get(id);
        if (!elements) {
            elements = [];
            this.idsMap.set(id, elements);
        }
        elements.push(element);
    }

    removeId(id: string, element: Element) {
        const elements = this.idsMap.get(id);
        if (elements) {
            this.idsMap.set(
                id,
                elements.filter((el) => el !== element),
            );
        }
    }

    getById(id: string): Element | undefined {
        const elements = this.idsMap.get(id);
        return elements ? elements[0] : undefined;
    }
}
