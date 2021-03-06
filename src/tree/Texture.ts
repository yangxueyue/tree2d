import { Stage } from "./Stage";
import { Element } from "./Element";

export class Texture {
    private manager = this.stage.textureManager;

    private id: number = Texture.id++;

    public static id = 0;

    // All enabled elements that use this texture object (either as texture or displayedTexture).
    private elements = new Set<Element>();

    // The number of enabled elements that are active.
    private _activeCount: number = 0;

    private _source?: TextureSource = undefined;

    // Texture clipping coordinates.
    private _x: number = 0;
    private _y: number = 0;
    private _w: number = 0;
    private _h: number = 0;

    // Render precision (0.5 = fuzzy, 1 = normal, 2 = sharp even when scaled twice, etc.).
    private _pixelRatio: number = 1;

    /**
     * The (maximum) expected texture source dimensions. Used for within bounds determination while texture is not yet loaded.
     * If not set, 2048 is used by ElementCore.update.
     */
    public mw: number = 0;
    public mh: number = 0;

    // Flag that indicates that this texture uses clipping.
    private clipping: boolean = false;

    // Indicates whether this texture must update (when it becomes used again).
    private _mustUpdate: boolean = true;

    constructor(protected stage: Stage) {}

    private get source(): TextureSource | undefined {
        return this.getUpdatedSource();
    }

    getUpdatedSource(): TextureSource | undefined {
        if (this._mustUpdate || this.stage.hasUpdateTexture(this)) {
            this._performUpdateSource(true);
            this.stage.removeUpdateTexture(this);
        }
        return this._source;
    }

    getSource(): TextureSource | undefined {
        return this._source;
    }

    addElement(v: Element) {
        if (!this.elements.has(v)) {
            this.elements.add(v);

            if (this.elements.size === 1) {
                if (this._source) {
                    this._source.addTexture(this);
                }
            }

            if (v.active) {
                this.incActiveCount();
            }
        }
    }

    removeElement(v: Element) {
        if (this.elements.delete(v)) {
            if (this.elements.size === 0) {
                if (this._source) {
                    this._source.removeTexture(this);
                }
            }

            if (v.active) {
                this.decActiveCount();
            }
        }
    }

    getElements() {
        return this.elements;
    }

    incActiveCount() {
        // Ensure that texture source's activeCount has transferred ownership.
        const source = this.source;

        if (source) {
            this._checkForNewerReusableTextureSource();
        }

        this._activeCount++;
        if (this._activeCount === 1) {
            this.becomesUsed();
        }
    }

    decActiveCount() {
        const source = this.getUpdatedSource(); // Force updating the source.
        this._activeCount--;
        if (!this._activeCount) {
            this.becomesUnused();
        }
    }

    becomesUsed() {
        const source = this.getUpdatedSource();
        source?.incActiveTextureCount();
    }

    onLoad() {
        this.elements.forEach((element) => {
            if (element.active) {
                element.onTextureSourceLoaded();
            }
        });
    }

    _checkForNewerReusableTextureSource() {
        // When this source became unused and cleaned up, it may have disappeared from the reusable texture map.
        // In the meantime another texture may have been generated loaded with the same lookup id.
        // If this is the case, use that one instead to make sure only one active texture source per lookup id exists.
        const source = this.source!;
        if (!source.isLoaded()) {
            const reusable = this._getReusableTextureSource();
            if (reusable && reusable.isLoaded() && reusable !== source) {
                this._replaceTextureSource(reusable);
            }
        }
    }

    private becomesUnused() {
        if (this.source) {
            this.source.decActiveTextureCount();
        }
    }

    isUsed() {
        return this._activeCount > 0;
    }

    // Returns the lookup id for the current texture settings, to be able to reuse it.
    protected _getLookupId(): string | undefined {
        // Default: do not reuse texture.
        return undefined;
    }

    /**
     * Generates a loader function that is able to generate the texture for the current settings of this texture.
     * The loader itself may return a Function that is called when loading of the texture is cancelled. This can be used
     * to stop fetching an image when it is no longer in element, for example.
     */
    protected _getSourceLoader(): TextureSourceLoader {
        throw new Error("Texture.generate must be implemented.");
    }

    get isValid() {
        return this._getIsValid();
    }

    /**
     * If texture is not 'valid', no source can be created for it.
     */
    protected _getIsValid(): boolean {
        return true;
    }

    /**
     * This must be called when the texture source must be re-generated.
     */
    _changed() {
        // If no element is actively using this texture, ignore it altogether.
        if (this.isUsed()) {
            this._updateSource();
        } else {
            this._mustUpdate = true;
        }
    }

    private _updateSource() {
        // We delay all updateSource calls to the next drawFrame, so that we can bundle them.
        // Otherwise we may reload a texture more often than necessary, when, for example, patching multiple text
        // properties.
        this.stage.addUpdateTexture(this);
    }

    _performUpdateSource(force = false) {
        // If, in the meantime, the texture was no longer used, just remember that it must update until it becomes used
        // again.
        if (force || this.isUsed()) {
            this._mustUpdate = false;
            const source = this._getTextureSource();
            this._replaceTextureSource(source);
        }
    }

    private _getTextureSource(): TextureSource | undefined {
        let source;
        if (this._getIsValid()) {
            const lookupId = this._getLookupId();
            source = this._getReusableTextureSource(lookupId);
            if (!source) {
                source = this.manager.getTextureSource(this._getSourceLoader(), lookupId);
            }
        }
        return source;
    }

    private _getReusableTextureSource(lookupId = this._getLookupId()): TextureSource | undefined {
        if (this._getIsValid()) {
            if (lookupId) {
                return this.manager.getReusableTextureSource(lookupId);
            }
        }
        return undefined;
    }

    private _replaceTextureSource(newSource: TextureSource | undefined) {
        const oldSource = this._source;

        this._source = newSource;

        if (oldSource) {
            if (this._activeCount) {
                oldSource.decActiveTextureCount();
            }

            oldSource.removeTexture(this);
        }

        if (newSource) {
            // Must happen before setDisplayedTexture to ensure sprite map texcoords are used.
            newSource.addTexture(this);
            if (this._activeCount) {
                newSource.incActiveTextureCount();
            }
        }

        if (this.isUsed()) {
            if (newSource) {
                if (newSource.isLoaded()) {
                    this.elements.forEach((element) => {
                        if (element.active) {
                            element.setDisplayedTexture(this);
                        }
                    });
                } else {
                    const loadError = newSource.loadError;
                    if (loadError) {
                        this.elements.forEach((element) => {
                            if (element.active) {
                                element.onTextureSourceLoadError(loadError);
                            }
                        });
                    }
                }
            } else {
                this.elements.forEach((element) => {
                    if (element.active) {
                        element.setDisplayedTexture(undefined);
                    }
                });
            }
        }
    }

    load() {
        // Make sure that source is up to date.
        if (this.source) {
            if (!this.isLoaded()) {
                this.source.load();
            }
        }
    }

    isLoaded() {
        return this._source ? this._source.isLoaded() : false;
    }

    get loadError() {
        return this._source ? this._source.loadError : undefined;
    }

    free() {
        if (this._source) {
            this._source.free();
        }
    }

    hasClipping() {
        return this.clipping;
    }

    private _updateClipping() {
        this.clipping = !!(this._x || this._y || this._w || this._h);

        this.elements.forEach((element) => {
            // Ignore if not the currently displayed texture.
            if (element.displayedTexture === this) {
                element.onDisplayedTextureClippingChanged();
            }
        });
    }

    private _updatePixelRatio() {
        this.elements.forEach((element) => {
            // Ignore if not the currently displayed texture.
            if (element.displayedTexture === this) {
                element.onPixelRatioChanged();
            }
        });
    }

    getNonDefaults(): any {
        const nonDefaults: Record<string, any> = {};
        nonDefaults["type"] = this.constructor.name;
        if (this.x !== 0) nonDefaults["x"] = this.x;
        if (this.y !== 0) nonDefaults["y"] = this.y;
        if (this.w !== 0) nonDefaults["w"] = this.w;
        if (this.h !== 0) nonDefaults["h"] = this.h;
        if (this.pixelRatio !== 1) nonDefaults["pixelRatio"] = this.pixelRatio;
        return nonDefaults;
    }

    get px() {
        return this._x * this._pixelRatio;
    }

    get py() {
        return this._y * this._pixelRatio;
    }

    get pw() {
        return this._w * this._pixelRatio;
    }

    get ph() {
        return this._h * this._pixelRatio;
    }

    get x() {
        return this._x;
    }

    set x(v) {
        if (this._x !== v) {
            this._x = v;
            this._updateClipping();
        }
    }

    get y() {
        return this._y;
    }

    set y(v) {
        if (this._y !== v) {
            this._y = v;
            this._updateClipping();
        }
    }

    get w() {
        return this._w;
    }

    set w(v: number) {
        if (this._w !== v) {
            this._w = v;
            this._updateClipping();
        }
    }

    get h() {
        return this._h;
    }

    set h(v: number) {
        if (this._h !== v) {
            this._h = v;
            this._updateClipping();
        }
    }

    get pixelRatio() {
        return this._pixelRatio;
    }

    set pixelRatio(v) {
        if (this._pixelRatio !== v) {
            this._pixelRatio = v;
            this._updatePixelRatio();
        }
    }

    isAutosizeTexture() {
        return true;
    }

    getRenderWidth() {
        if (!this.isAutosizeTexture()) {
            // In case of the rectangle texture, we'd prefer to not cause a 1x1 w,h as it would interfere with flex layout fit-to-contents.
            return 0;
        }

        let w = this._w;
        if (this._source) {
            // Max out to edge of source texture.
            const sourceW = this._source.getRenderWidth() / this._pixelRatio;
            if (w) {
                w = Math.min(sourceW, w);
            } else {
                w = sourceW;
            }
            w -= this._x;
        } else {
            w = 0;
        }
        return w;
    }

    getRenderHeight() {
        if (!this.isAutosizeTexture()) {
            return 0;
        }

        let h = this._h;
        if (this._source) {
            // Max out to edge of source texture.
            const sourceH = this._source.getRenderHeight() / this._pixelRatio;
            if (h) {
                h = Math.min(sourceH, h);
            } else {
                h = sourceH;
            }
            h -= this._y;
        } else {
            h = 0;
        }
        return h;
    }

    static getLookupIdFromSettings(obj: object): string {
        if (Array.isArray(obj)) {
            return obj.map((o) => this.getLookupIdFromSettings(o)).join(",");
        } else if (Utils.isObjectLiteral(obj)) {
            const parts = [];
            for (const [key, value] of Object.entries(obj)) {
                parts.push(key + "=" + this.getLookupIdFromSettings(value));
            }
            return parts.join("|");
        } else if (obj === undefined) {
            return "";
        } else {
            return "" + obj;
        }
    }
}

export type TextureSourceLoader = (
    cb: TextureSourceCallback,
    textureSource: TextureSource,
) => TextureSourceCancelFunction | void;
export type TextureSourceCallback = (error: Error | undefined, options?: TextureSourceOptions) => void;
export type TextureSourceCancelFunction = () => void;
export type TextureDrawableSource = Uint8Array | Uint8ClampedArray | WebGLTexture | TexImageSource;
export type TextureSourceOptions = {
    source: TextureDrawableSource;
    width?: number;
    height?: number;
    permanent?: boolean;
    hasAlpha?: boolean;
    premultiplyAlpha?: boolean;
    renderInfo?: any;
    texParams?: Record<GLenum, GLenum>;
    texOptions?: {
        format?: number;
        internalFormat?: number;
        type?: GLenum;
    };
};

import { TextureSource } from "./TextureSource";
import { Utils } from "./Utils";
