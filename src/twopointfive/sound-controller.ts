import type Phaser from 'phaser';

export type TPFSound = Phaser.Sound.BaseSound;
export type TPFSoundEntry = TPFSound | TPFSound[];

class TwoPointFiveSoundController {
  scene: Phaser.Scene;
  sounds: Record<string, TPFSoundEntry>;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.sounds = {};
  }

  add(name: string, key: string, config?: Phaser.Types.Sound.SoundConfig): TPFSound {
    const sound = this.scene.sound.add(key, config);
    this.sounds[name] = sound;
    return sound;
  }

  addMany(name: string, keys: string[], config?: Phaser.Types.Sound.SoundConfig): TPFSound[] {
    const sounds = keys.map((key) => this.scene.sound.add(key, config));
    this.sounds[name] = sounds;
    return sounds;
  }

  get(name: string): TPFSoundEntry | null {
    return this.sounds[name] || null;
  }

  getOne(name: string): TPFSound | null {
    const sound = this.sounds[name];
    return sound && !Array.isArray(sound) ? sound : null;
  }

  getMany(name: string): TPFSound[] {
    const sound = this.sounds[name];
    return Array.isArray(sound) ? sound : [];
  }

  clear(): void {
    for (const name in this.sounds) {
      const sound = this.sounds[name];
      if (Array.isArray(sound)) {
        for (const item of sound) item.destroy();
      } else {
        sound.destroy();
      }
    }
    this.sounds = {};
  }
}

export default TwoPointFiveSoundController;
