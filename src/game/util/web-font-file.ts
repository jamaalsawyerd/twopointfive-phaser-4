/**
 * Phaser loader file for Google Fonts (webfontloader). Used in preload so HUD text can use a custom font.
 */
import Phaser from 'phaser';
import WebFontLoader from 'webfontloader';

/** Loader file that triggers webfontloader and calls loader.nextFile when fonts are active. */
class WebFontFile extends Phaser.Loader.File {
  fontNames: string[];
  service: string;
  fontsLoadedCount: number;

  constructor(loader: Phaser.Loader.LoaderPlugin, fontNames: string | string[], service?: string) {
    super(loader, {
      type: 'webfont',
      // webfontloader adds the fonts to the document, so there is no Phaser cache to store them in.
      cache: false,
      key: fontNames.toString(),
    });
    this.fontNames = Array.isArray(fontNames) ? fontNames : [fontNames];
    this.service = service || 'google';
    this.fontsLoadedCount = 0;
  }

  load(): void {
    const config: WebFont.Config = {
      fontactive: (familyName: string) => {
        this._checkLoaded(familyName);
      },
      fontinactive: (familyName: string) => {
        this._checkLoaded(familyName);
      },
    };

    switch (this.service) {
      case 'google':
        config.google = { families: this.fontNames };
        break;
      default:
        throw new Error('Unsupported font service: ' + this.service);
    }

    WebFontLoader.load(config);
  }

  _checkLoaded(familyName: string): void {
    if (!this.fontNames.includes(familyName)) return;
    this.fontsLoadedCount++;
    if (this.fontsLoadedCount >= this.fontNames.length) {
      this.loader.nextFile(this, true);
    }
  }
}

export default WebFontFile;
