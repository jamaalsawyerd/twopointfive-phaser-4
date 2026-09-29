/**
 * Main Phaser scene: preload, create (level, player, weapon, HUD, input, TpfExtern), and update (input to player, tpf.update, spawn).
 * Death and damage are proactive (showDeathAnim, HudBlood.show). HUD text is updated via scene callbacks from player/weapon/blob.
 */
import Phaser from 'phaser';
import type { TwoPointFiveScenePlugin } from '~/twopointfive/two-point-five-plugin.ts';
import { TwoPointFivePlugin } from '~/twopointfive/two-point-five-plugin.ts';
import {
  WeaponGrenadeLauncher,
  EntityGrenade,
  EntityGrenadeDirectional,
  EntityGrenadeExplosion,
  EntityBlastRadius,
} from '~/game/tpf/grenade-launcher.ts';
import {
  EntityEnemyBlobSpawner,
  EntityEnemyBlobSpawnerDirectional,
  EntityEnemyBlob,
  EntityEnemyBlobDirectional,
  EntityEnemyBlobGib,
} from '~/game/tpf/enemy-blob.ts';
import EntityHealthPickup from '~/game/tpf/health-pickup.ts';
import EntityVoid from '~/game/tpf/entity-void.ts';
import EntityPlayer from '~/game/tpf/entity-player.ts';
import EntityGrenadePickup from '~/game/tpf/grenade-pickup.ts';
import { HudBlood } from '~/game/tpf/hud-blood.ts';
import { HudMinimap } from '~/game/tpf/hud-minimap.ts';
import type { MinimapLayer, MinimapMarkerStyle } from '~/game/tpf/hud-minimap.ts';
import { WAVY_FILTER_NODE, FilterWavyRenderNode, WavyFilterController } from '~/game/filters/wavy-filter.ts';
import WebFontFile from '~/game/util/web-font-file.ts';
import type TPFEntity from '~/twopointfive/entity.ts';
import type { ImageInfo, EntityContext, LevelData, TPFResolvedView, TPFViewConfig } from '~/twopointfive/types.ts';
import type { TPFSoundEntry } from '~/twopointfive/sound-controller.ts';
import type Map from '~/twopointfive/world/map.ts';

const WIDTH = 1280;
const HEIGHT = 720;

/** Internal-resolution steps cycled by the R key; see the keybind in create(). */
const RESOLUTION_STEPS: { label: string; view: TPFViewConfig }[] = [
  { label: 'native (720p)', view: { resolution: null, scale: null, filter: 'nearest' } },
  { label: '480p', view: { resolution: 480, scale: null, filter: 'nearest' } },
  { label: '240p', view: { resolution: 240, scale: null, filter: 'nearest' } },
  { label: '2x SSAA', view: { resolution: null, scale: 2, filter: 'linear' } },
];

/** Minimap markers per entity kind, picked by the classify callback in create(). Blobs are blue in the world too. */
const MINIMAP_STYLES = {
  blob: { layer: 'enemies', shape: 'dot', color: 0x6fc3ff },
  spawner: { layer: 'enemies', shape: 'ring', color: 0x6fc3ff },
  // Pickups stay put, so under fog of war they stay on the map once seen, until collected.
  health: { layer: 'pickups', icon: 'health', remember: true },
  ammo: { layer: 'pickups', icon: 'grenade-pickup', remember: true },
} satisfies Record<string, MinimapMarkerStyle>;

/** Minimap layers toggled by the number keys, in key order. */
const MINIMAP_LAYER_KEYS: { key: string; layer: MinimapLayer }[] = [
  { key: 'ONE', layer: 'map' },
  { key: 'TWO', layer: 'player' },
  { key: 'THREE', layer: 'enemies' },
  { key: 'FOUR', layer: 'pickups' },
];

/** The special keys, listed in the bottom-left corner. Add new toggles here as well as binding them in create(). */
const CONTROLS_HELP: { keys: string; action: string }[] = [
  { keys: 'G', action: 'entity shader' },
  { keys: 'F', action: 'wavy filter' },
  { keys: 'R', action: 'resolution' },
  { keys: 'M', action: 'minimap' },
  // One line per layer keeps the column narrow enough to stay clear of the weapon in tall windows.
  { keys: '1', action: 'map layer' },
  { keys: '2', action: 'player layer' },
  { keys: '3', action: 'enemies layer' },
  { keys: '4', action: 'pickups layer' },
  { keys: '[ ]', action: 'minimap zoom' },
  { keys: 'V', action: 'fog of war' },
  { keys: 'X', action: 'automap' },
  { keys: 'P', action: 'enemies on/off' },
  { keys: 'B', action: '8-way sprites' },
];

/** Single scene: loads level into tpf, creates player and weapon, HUD, pointer lock, and TpfExtern. */
export class MainScene extends Phaser.Scene {
  declare tpf: TwoPointFiveScenePlugin;

  _player: EntityPlayer | null;
  _weaponImages: Record<string, ImageInfo>;
  _enemyImages: Record<string, ImageInfo>;
  _sounds: Record<string, TPFSoundEntry>;
  _killCount: number;
  _dead: boolean;
  _deathAnimActive: boolean;
  _deathAnimDuration: number;

  _blobSpawnWaitInitial: number;
  _blobSpawnWaitCurrent: number;
  _blobSpawnWaitDiv: number;
  _blobSpawnTimer: number;

  _floorMap: Map | null;
  _powerupSpawnWait: number;
  _powerupSpawnTimer: number;
  _deathMessageShown: boolean;
  _deathText: Phaser.GameObjects.Text | null;

  _tpfExtern: Phaser.GameObjects.Extern | null;
  _hudHealthIcon: Phaser.GameObjects.Image | null;
  _hudHealthText: Phaser.GameObjects.Text | null;
  _hudAmmoIcon: Phaser.GameObjects.Image | null;
  _hudAmmoText: Phaser.GameObjects.Text | null;
  _hudKillsText: Phaser.GameObjects.Text | null;
  _hudHelpKeys: Phaser.GameObjects.Text | null;
  _hudHelpActions: Phaser.GameObjects.Text | null;
  _hudBlood: HudBlood | null;
  _hudMinimap: HudMinimap | null;
  _wavyFilter: WavyFilterController | null;
  _wavyWeaponFilter: WavyFilterController | null;
  _gShaderOn: boolean;
  _pulseUniforms: { time: number };
  _resolutionStep: number;
  /** False while the P key has enemies switched off. Blobs and spawners read it through their injected scene. */
  enemiesActive: boolean;
  /**
   * False while the B key has the 8-direction sprites (blobs, spawners, grenades) on their original one angle,
   * and blobs on their original steering. Each reads it through its injected scene.
   */
  directionalSprites: boolean;

  constructor() {
    super({ key: 'Main' });
    this._player = null;
    this._weaponImages = {};
    this._enemyImages = {};
    this._sounds = {};
    this._killCount = 0;
    this._dead = false;
    this._deathAnimActive = false;
    this._deathAnimDuration = 1;

    this._blobSpawnWaitInitial = 2;
    this._blobSpawnWaitCurrent = 2;
    this._blobSpawnWaitDiv = 1.01;
    this._blobSpawnTimer = 2;

    this._floorMap = null;
    this._powerupSpawnWait = 8;
    this._powerupSpawnTimer = 8;
    this._deathMessageShown = false;
    this._deathText = null;

    this._tpfExtern = null;
    this._hudHealthIcon = null;
    this._hudHealthText = null;
    this._hudAmmoIcon = null;
    this._hudAmmoText = null;
    this._hudKillsText = null;
    this._hudHelpKeys = null;
    this._hudHelpActions = null;
    this._hudBlood = null;
    this._hudMinimap = null;
    this._wavyFilter = null;
    this._wavyWeaponFilter = null;
    this._gShaderOn = false;
    this._pulseUniforms = { time: 0 };
    this._resolutionStep = 0;
    this.enemiesActive = true;
    this.directionalSprites = true;
  }

  preload(): void {
    this.load.addFile(new WebFontFile(this.load, 'Fredoka One'));

    this.load.image('tiles', 'media/tiles/basic-tiles-64.png');
    this.load.image('lights', 'media/tiles/lights-64.png');
    this.load.json('level', 'media/levels/base1.json');

    this.load.spritesheet('grenade-launcher', 'media/grenade-launcher.png', { frameWidth: 180, frameHeight: 134 });
    this.load.image('grenade', 'media/grenade.png');
    this.load.image('grenade-directions', 'media/grenade-directions.png');
    this.load.image('explosion', 'media/explosion.png');

    this.load.image('grenade-pickup', 'media/grenade-pickup.png');
    this.load.image('health', 'media/health.png');

    this.load.image('blob-spawn', 'media/blob-spawn.png');
    this.load.image('blob-spawn-directions', 'media/blob-spawn-directions.png');
    this.load.image('blob', 'media/blob.png');
    this.load.image('blob-directions', 'media/blob-directions.png');
    this.load.image('blob-gib', 'media/blob-gib.png');

    this.load.image('health-icon', 'media/health-icon.png');
    this.load.image('hud-blood', 'media/hud-blood-low.png');

    this.load.audio('snd-grenade-launcher', 'media/sounds/grenade-launcher.ogg');
    this.load.audio('snd-empty-click', 'media/sounds/empty-click.ogg');
    this.load.audio('snd-explosion', 'media/sounds/explosion.ogg');
    this.load.audio('snd-grenade-bounce', 'media/sounds/grenade-bounce.ogg');
    this.load.audio('snd-health-pickup', 'media/sounds/health-pickup.ogg');
    this.load.audio('snd-blob-gib', 'media/sounds/blob-gib.ogg');
    this.load.audio('snd-hurt1', 'media/sounds/hurt1.ogg');
    this.load.audio('snd-hurt2', 'media/sounds/hurt2.ogg');
    this.load.audio('snd-hurt3', 'media/sounds/hurt3.ogg');
  }

  create(): void {
    const tpf = this.tpf;
    if (!tpf) return;
    if (!tpf.getRenderer()) {
      this.time.delayedCall(100, () => this.scene.restart());
      return;
    }

    // Lay the HUD and weapon out against the resolved view rather than the WIDTH/HEIGHT config
    // constants. `world` is the rectangle the 2.5D view occupies; it currently fills the canvas but
    // will not once the world can be given its own aspect ratio, so anchoring to it now keeps this
    // correct either way.
    const view = tpf.getView();

    tpf.setTileset('media/tiles/basic-tiles-64.png', 'tiles');
    tpf.setTileset('media/tiles/lights-64.png', 'lights');
    const lightsTexture = this.textures.get('lights');
    const lightsSource = lightsTexture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
    if (lightsSource) {
      const canvas = document.createElement('canvas');
      canvas.width = lightsSource.width;
      canvas.height = lightsSource.height;
      const ctx2d = canvas.getContext('2d')!;
      ctx2d.drawImage(lightsSource, 0, 0);
      const imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
      tpf.setLightMapPixels('media/tiles/lights-64.png', imageData);
    }

    this._weaponImages = {
      grenade: tpf.loadImage('grenade')!,
      grenadeDirections: tpf.loadImage('grenade-directions')!,
      explosion: tpf.loadImage('explosion')!,
      grenadePickup: tpf.loadImage('grenade-pickup')!,
    };

    this._enemyImages = {
      blobSpawn: tpf.loadImage('blob-spawn')!,
      blobSpawnDirections: tpf.loadImage('blob-spawn-directions')!,
      blob: tpf.loadImage('blob')!,
      blobDirections: tpf.loadImage('blob-directions')!,
      blobGib: tpf.loadImage('blob-gib')!,
      health: tpf.loadImage('health')!,
    };

    const soundController = tpf.getSoundController();
    this._sounds = soundController
      ? {
          shoot: soundController.add('shoot', 'snd-grenade-launcher', { volume: 0.8 }),
          empty: soundController.add('empty', 'snd-empty-click'),
          explosion: soundController.add('explosion', 'snd-explosion', { volume: 0.9 }),
          bounce: soundController.add('bounce', 'snd-grenade-bounce', { volume: 0.6 }),
          pickup: soundController.add('pickup', 'snd-health-pickup'),
          blobGib: soundController.add('blobGib', 'snd-blob-gib', { volume: 0.6 }),
          hurt: soundController.addMany('hurt', ['snd-hurt1', 'snd-hurt2', 'snd-hurt3']),
        }
      : {};

    tpf.registerEntityClass(
      'EntityVoid',
      EntityVoid as unknown as new (
        x: number,
        y: number,
        settings: Record<string, unknown>,
        context: EntityContext,
      ) => TPFEntity,
    );
    tpf.registerEntityClass(
      'EntityPlayer',
      EntityPlayer as unknown as new (
        x: number,
        y: number,
        settings: Record<string, unknown>,
        context: EntityContext,
      ) => TPFEntity,
    );

    const grenadeFactory = (
      x: number,
      y: number,
      settings: Record<string, unknown>,
      context: EntityContext,
    ): TPFEntity => {
      settings = settings;
      settings.bounceSound = this._sounds.bounce;
      settings.explodeSound = this._sounds.explosion;
      settings.grenadeImage = this._weaponImages.grenade;
      settings.grenadeDirectionsImage = this._weaponImages.grenadeDirections;
      settings.scene = this;
      settings.explosionImage = this._weaponImages.explosion;
      settings.EntityGrenadeExplosion = explosionFactory;
      settings.EntityBlastRadius = EntityBlastRadius;
      // Directional in both B modes: with B off it shows one angle, like EntityGrenade.
      return new EntityGrenadeDirectional(x, y, settings, context);
    };

    const explosionFactory = (
      x: number,
      y: number,
      settings: Record<string, unknown>,
      context: EntityContext,
    ): TPFEntity => {
      settings = settings;
      settings.explosionImage = this._weaponImages.explosion;
      return new EntityGrenadeExplosion(x, y, settings, context);
    };

    const levelData = this.cache.json.get('level') as LevelData | undefined;
    if (levelData) {
      const info = levelData.entities.find((e) => e.settings?.name === 'info');
      if (info?.settings) {
        const s = info.settings;
        if (s.sectorSize != null) tpf.sectorSize = s.sectorSize as number;
      }
      tpf.loadLevel(levelData);
      if (info?.settings) {
        const s = info.settings;
        if (s.fogColor != null)
          tpf.setFog(Number(s.fogColor), (s.fogNear as number) || 128, (s.fogFar as number) || 512);
      }

      const player = tpf.getGameState()?.entities.find(function (e) {
        return e instanceof EntityPlayer;
      });
      if (player) {
        this._player = player;
        const inputController = tpf.getInputController();
        player._cursors = inputController ? inputController.actions : null;

        const weapon = new WeaponGrenadeLauncher({
          ammo: 16,
          textureKey: 'grenade-launcher',
          scene: this,
          depth: 900,
          tileWidth: 180,
          tileHeight: 134,
          hudWidth: view.world.width,
          hudHeight: view.world.height,
          hudX: view.world.x,
          hudY: view.world.y,
          gameState: tpf.getGameState(),
          sounds: {
            shoot: this._sounds.shoot as { play(): void },
            empty: this._sounds.empty as { play(): void },
          },
          EntityGrenade: grenadeFactory as unknown as typeof EntityGrenade,
          onAmmoChange: (ammo: number) => {
            this.updateAmmoDisplay(ammo);
          },
        });
        player.giveWeapon(weapon);

        player._hurtSounds = this._sounds.hurt as { play(): void }[];
        player._scene = this;
      }

      const gs = tpf.getGameState();
      this._floorMap = gs ? gs.getMapByName('floor') : null;
      this._powerupSpawnWait = 8;
      this._powerupSpawnTimer = this._powerupSpawnWait;

      this._dead = false;
      this._deathAnimActive = false;
      this._deathMessageShown = false;
      this._killCount = 0;
      this._blobSpawnWaitCurrent = this._blobSpawnWaitInitial;
      this._blobSpawnTimer = this._blobSpawnWaitInitial;

      const cam = tpf.getCamera();
      if (cam && !player) cam.setPosition(1010, 818, 0);
    }

    this._tpfExtern = tpf.createExtern();

    const hudStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: '"Fredoka One", Arial, sans-serif',
      fontSize: '24px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    };

    // Sizes and positions are set by layoutHud().
    this._hudHealthIcon = this.add.image(0, 0, 'health-icon').setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    this._hudHealthText = this.add.text(0, 0, '100', hudStyle).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1000);

    this._hudAmmoIcon = this.add.image(0, 0, 'grenade').setOrigin(0.5).setScrollFactor(0).setDepth(1000);
    this._hudAmmoText = this.add.text(0, 0, '16', hudStyle).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1000);

    this._hudKillsText = this.add.text(0, 0, 'Kills: 0', hudStyle).setOrigin(0, 0.5).setScrollFactor(0).setDepth(1000);

    // The controls list: two columns, keys right-aligned beside their actions. Both texts share a font size
    // and line spacing, so their lines stay level; layoutHud() places the actions just past the keys.
    const helpStyle: Phaser.Types.GameObjects.Text.TextStyle = { ...hudStyle, fontSize: '16px', lineSpacing: 2 };
    this._hudHelpKeys = this.add
      .text(0, 0, CONTROLS_HELP.map((c) => c.keys).join('\n'), { ...helpStyle, color: '#ffd84a', align: 'right' })
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(1000);
    this._hudHelpActions = this.add
      .text(0, 0, CONTROLS_HELP.map((c) => c.action).join('\n'), helpStyle)
      .setOrigin(0, 1)
      .setScrollFactor(0)
      .setDepth(1000);

    this._hudBlood = new HudBlood(this, {
      viewWidth: view.world.width,
      viewHeight: view.world.height,
      viewX: view.world.x,
      viewY: view.world.y,
    });

    // The minimap reads the level's walls once here, so it is built after loadLevel(). It sizes and
    // anchors itself in layoutHud(), like the rest of the HUD.
    const gameState = tpf.getGameState();
    const camera = tpf.getCamera();
    this._hudMinimap =
      gameState && camera
        ? new HudMinimap(this, {
            gameState,
            camera,
            // The world is fogged out beyond fogFar, so the view cone stops there too.
            visibleRange: tpf.getRenderer()?.fog?.far ?? Infinity,
            // The demo starts with both on; V and X switch them off.
            fogOfWar: true,
            automap: true,
            textStyle: hudStyle,
            classify: (entity) => {
              if (entity instanceof EntityEnemyBlob) return MINIMAP_STYLES.blob;
              if (entity instanceof EntityEnemyBlobSpawner) return MINIMAP_STYLES.spawner;
              if (entity instanceof EntityHealthPickup) return MINIMAP_STYLES.health;
              if (entity instanceof EntityGrenadePickup) return MINIMAP_STYLES.ammo;
              return null;
            },
          })
        : null;

    const deathStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: '"Fredoka One", Arial, sans-serif',
      fontSize: '48px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 4,
      align: 'center',
    };
    this._deathText = this.add
      .text(0, 0, 'You are Dead!', deathStyle)
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(2000)
      .setVisible(false);

    // Place everything now, then again whenever the view changes. `viewchange` covers both canvas
    // resizes (Scale.EXPAND/RESIZE) and programmatic setView calls, so this is the only place HUD
    // positions are computed. Subscribing in create() is deliberate: the plugin drops listeners on
    // scene shutdown, so a restarted scene re-subscribes with its new Game Objects.
    this.layoutHud(view);
    tpf.events.on('viewchange', this.layoutHud, this);

    // Example: press F to toggle the wavy filter. Demonstrates adding a custom GLSL shader via the
    // Phaser 4 Filters hook. It is applied both to the world (the Extern) and to the first-person
    // weapon (a separate HUD Phaser Image) so they share the wavy look, while the 2D HUD text stays
    // crisp. A Phaser filter only affects the GameObject it is enabled on, so each target needs its
    // own controller. Controllers belong to per-run filter cameras, so they are recreated after a
    // restart.
    // Example: press G to toggle an animated entity material. Demonstrates the TPFQuadBatch
    // material system: a composable fragment-shader body applied per entity via setMaterial.
    // Entities keep wall occlusion and fog because they still render in the depth-tested world
    // pass — this is per-entity shading, not a Phaser GameObject filter. It also shows per-frame
    // uniforms (`time` lives in a shared uniforms object mutated in update(); the node re-applies
    // material uniforms on every activation and the program wrapper diff-checks them) and
    // persistence (while the flag is on, update() sweeps newly spawned entities — fire a grenade
    // and the explosion pulses too). Entities share one material key with no per-entity uniforms,
    // so they all batch into a single draw call.
    this._pulseUniforms = { time: 0 };
    tpf.registerMaterial('demo-pulse', {
      fragmentUniforms: 'uniform float time;',
      fragmentBody: [
        '  float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));',
        '  vec3 cycle = 0.5 + 0.5 * vec3(sin(time * 3.0), sin(time * 3.0 + 2.094), sin(time * 3.0 + 4.188));',
        '  float pulse = 0.6 + 0.3 * sin(time * 6.0);',
        '  gl_FragColor.rgb = mix(gl_FragColor.rgb, cycle * (0.35 + lum * 1.4), pulse);',
      ].join('\n'),
      uniforms: this._pulseUniforms,
    });
    this._gShaderOn = false;
    this.input.keyboard?.on('keydown-G', (event: KeyboardEvent) => {
      // Ignore browser auto-repeat while the key is held; a toggle must fire once per press.
      if (event.repeat) return;
      this._gShaderOn = !this._gShaderOn;
      if (!this._gShaderOn) {
        const entities = this.tpf.getGameState()?.entities || [];
        for (const entity of entities) {
          if (entity.tile?.quad.material?.key === 'demo-pulse') entity.clearMaterial();
        }
      }
      // Turning on needs no work here: the per-frame sweep in update() applies the material.
    });

    // Example: press R to cycle the world's internal resolution. The 2.5D world renders into an
    // off-screen target at the chosen size and is scaled onto its on-screen rectangle, while the
    // HUD text and weapon stay crisp at canvas resolution — note how the readouts below never get
    // chunky. The last step renders at double resolution and downsamples, which is supersampling:
    // a cheap anti-alias rather than a retro look.
    this._resolutionStep = 0;
    this.input.keyboard?.on('keydown-R', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this._resolutionStep = (this._resolutionStep + 1) % RESOLUTION_STEPS.length;
      this.tpf.setView(RESOLUTION_STEPS[this._resolutionStep].view);
      this.updateKillsText();
    });

    this._wavyFilter = null;
    this._wavyWeaponFilter = null;
    this.input.keyboard?.on('keydown-F', (event: KeyboardEvent) => {
      // Ignore browser auto-repeat while the key is held; a toggle must fire once per press.
      if (event.repeat) return;
      // World (the Extern).
      const worldFilters = this.tpf.enableWorldFilters();
      if (worldFilters) {
        if (this._wavyFilter) {
          this._wavyFilter.active = !this._wavyFilter.active;
        } else {
          this._wavyFilter = new WavyFilterController(worldFilters.internal.camera);
          worldFilters.internal.add(this._wavyFilter);
        }
      }

      // First-person weapon (a separate Phaser Image, so it needs its own filter). Force the
      // filter into context focus so it renders in screen space (like the world Extern) instead of
      // the weapon's local space; otherwise the waves ride along as the weapon bobs. This also
      // makes the weapon's wave phase match the world's.
      const weaponImage = this._player?.currentWeapon?.phaserImage;
      if (weaponImage) {
        if (this._wavyWeaponFilter) {
          this._wavyWeaponFilter.active = !this._wavyWeaponFilter.active;
        } else {
          weaponImage.enableFilters();
          weaponImage.setFiltersFocusContext(true);
          const weaponFilters = weaponImage.filters;
          if (weaponFilters) {
            this._wavyWeaponFilter = new WavyFilterController(weaponFilters.internal.camera);
            weaponFilters.internal.add(this._wavyWeaponFilter);
          }
        }
      }
    });

    // Minimap: M shows or hides it, 1-4 toggle its layers (map, player, enemies, pickups), [ and ] zoom out
    // and in, V toggles fog of war, and X the Doom-style automap that only shows walls you have looked at.
    this.input.keyboard?.on('keydown-M', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this._hudMinimap?.toggleVisible();
    });
    for (const { key, layer } of MINIMAP_LAYER_KEYS) {
      this.input.keyboard?.on(`keydown-${key}`, (event: KeyboardEvent) => {
        if (event.repeat) return;
        this._hudMinimap?.toggleLayer(layer);
      });
    }
    this.input.keyboard?.on('keydown-OPEN_BRACKET', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this._hudMinimap?.zoomOut();
    });
    this.input.keyboard?.on('keydown-CLOSED_BRACKET', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this._hudMinimap?.zoomIn();
    });
    this.input.keyboard?.on('keydown-V', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this._hudMinimap?.toggleFogOfWar();
    });
    this.input.keyboard?.on('keydown-X', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this._hudMinimap?.toggleAutomap();
    });

    // Press P to switch enemies off and on: blobs freeze in place and do no damage, spawners stay idle,
    // and no new ones spawn. Pickups keep coming. Handy for exploring, or for testing the fog of war
    // against enemies that hold still.
    this.enemiesActive = true;
    this.input.keyboard?.on('keydown-P', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this.enemiesActive = !this.enemiesActive;
      this.updateKillsText();
    });

    // Press B to switch between the 8-direction sprites and the original one-angle ones: blobs (which also go
    // back from turning to follow you to snapping straight at you), spawners and grenades. Every one switches
    // at once, including ones on screen.
    this.directionalSprites = true;
    this.input.keyboard?.on('keydown-B', (event: KeyboardEvent) => {
      if (event.repeat) return;
      this.directionalSprites = !this.directionalSprites;
      this.updateKillsText();
    });
  }

  /**
   * Positions and sizes every HUD element against the 2.5D view's rectangle. Runs on create and on
   * each `viewchange`, so a canvas resize or an aspect-ratio change needs no other bookkeeping.
   * Anchoring to `view.world` rather than the canvas keeps the HUD attached to the 2.5D view when
   * that view is inset (letterboxed or pillarboxed) rather than filling the canvas.
   */
  layoutHud(view: TPFResolvedView): void {
    const { x, y, width, height } = view.world;
    // Sizes and offsets below are pixels at the config HEIGHT. Scaling them with the view's height, as
    // the weapon does, keeps the HUD the same size on screen when a window narrower than 16:9 makes
    // Scale.EXPAND grow the canvas height instead.
    const s = height / HEIGHT;
    const left = x + 16 * s;
    const row = (i: number): number => y + (24 + 40 * i) * s;

    // Kills, health, then grenades down the left edge; icons in a column with their values beside them.
    this._hudKillsText?.setScale(s).setPosition(left, row(0));
    this._hudHealthIcon?.setDisplaySize(32 * s, 32 * s).setPosition(left + 16 * s, row(1));
    this._hudHealthText?.setScale(s).setPosition(left + 40 * s, row(1));
    this._hudAmmoIcon?.setDisplaySize(32 * s, 32 * s).setPosition(left + 16 * s, row(2));
    this._hudAmmoText?.setScale(s).setPosition(left + 40 * s, row(2));
    // Controls list in the bottom-left corner, keys first and the actions just past the widest key.
    const bottom = y + height - 24 * s;
    this._hudHelpKeys?.setScale(s).setPosition(left, bottom);
    this._hudHelpActions?.setScale(s).setPosition(left + (this._hudHelpKeys?.displayWidth ?? 0) + 8 * s, bottom);
    this._deathText?.setScale(s).setPosition(x + width / 2, y + height / 2);
    this._hudBlood?.setViewRect(view.world, s);
    this._hudMinimap?.setViewRect(view.world, s, view.fov.horizontal);
    this._player?.currentWeapon?.setHudRect(view.world);
  }

  showDeathAnim(): void {
    this._deathAnimActive = true;
    const cam = this.tpf.getCamera();
    const tilesize = this.tpf.gameState?.collisionMap
      ? (this.tpf.gameState.collisionMap as { tilesize: number }).tilesize
      : 64;
    const endY = -(tilesize / 4);
    if (cam) {
      const target = { y: cam.position[1] };
      this.tweens.add({
        targets: target,
        y: endY,
        duration: this._deathAnimDuration * 1000,
        onUpdate: () => {
          if (cam) cam.position[1] = target.y;
        },
      });
    }
    this.time.delayedCall(this._deathAnimDuration * 1000, this.onDeathComplete, [], this);
  }

  onDeathComplete(): void {
    this._deathAnimActive = false;
    this._dead = true;
    if (!this._deathMessageShown) {
      this._deathMessageShown = true;
      if (this._deathText) this._deathText.setVisible(true);
    }
    const doRestart = () => {
      if (this._dead && this._deathMessageShown) {
        this.scene.restart();
      }
    };
    this.input.keyboard?.once('keydown-SPACE', doRestart);
    this.input.once('pointerdown', doRestart);
  }

  showDamageIndicator(): void {
    this._hudBlood?.show();
  }

  onPlayerHealthChanged(health: number): void {
    if (this._hudHealthText) this._hudHealthText.setText(String(health));
  }

  updateAmmoDisplay(ammo: number): void {
    if (this._hudAmmoText) this._hudAmmoText.setText(String(ammo));
  }

  incrementKillCount(): void {
    this._killCount++;
    this.updateKillsText();
  }

  /** Kill count plus a label for each demo toggle away from its default, so every writer shares one format. */
  updateKillsText(): void {
    const labels: string[] = [];
    if (this._resolutionStep !== 0) labels.push(RESOLUTION_STEPS[this._resolutionStep].label);
    if (!this.enemiesActive) labels.push('enemies off');
    if (!this.directionalSprites) labels.push('1-angle sprites');
    const suffix = labels.map((label) => `  [${label}]`).join('');
    if (this._hudKillsText) this._hudKillsText.setText(`Kills: ${String(this._killCount)}${suffix}`);
  }

  getRandomSpawnPos(): { x: number; y: number } {
    const fm = this._floorMap;
    if (!fm) return { x: 0, y: 0 };
    const ts = fm.tilesize;
    for (let attempts = 0; attempts < 200; attempts++) {
      const x = ((Math.random() * fm.width) | 0) * ts + ts / 2;
      const y = ((Math.random() * fm.height) | 0) * ts + ts / 2;
      if (fm.getTile(x, y)) {
        return { x: x, y: y };
      }
    }
    return { x: ts, y: ts };
  }

  checkSpawn(dt: number): void {
    if (!this._dead && !this._deathAnimActive) {
      // While enemies are switched off the blob timer holds rather than runs down, so switching them back on
      // does not release a burst of spawns.
      if (this.enemiesActive && this._floorMap && this._player) {
        this._blobSpawnTimer -= dt;
        if (this._blobSpawnTimer <= 0) {
          this.spawnBlob();
        }
      }

      if (this._floorMap && this._player) {
        this._powerupSpawnTimer -= dt;
        if (this._powerupSpawnTimer <= 0) {
          this.spawnPowerup();
          this._powerupSpawnTimer = this._powerupSpawnWait;
        }
      }
    }
  }

  spawnPowerup(): void {
    const gs = this.tpf.getGameState();
    if (!gs || !this._player || !this._floorMap) return;
    const pos = this.getRandomSpawnPos();

    const roll = Math.random();
    if (roll < 1 / 3) {
      gs.spawnEntity(
        ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => {
          settings = settings || {};
          settings.healthImage = this._enemyImages.health;
          settings.pickupSound = this._sounds.pickup;
          settings.player = this._player;
          return new EntityHealthPickup(x, y, settings, context);
        }) as unknown as new (x: number, y: number, s: Record<string, unknown>, c: EntityContext) => TPFEntity,
        pos.x,
        pos.y,
        {},
      );
    } else {
      gs.spawnEntity(
        ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => {
          settings = settings || {};
          settings.pickupSound = this._sounds.pickup;
          settings.animSheet = { image: this._weaponImages.grenadePickup, width: 32, height: 32 };
          return new EntityGrenadePickup(x, y, settings, context);
        }) as unknown as new (x: number, y: number, s: Record<string, unknown>, c: EntityContext) => TPFEntity,
        pos.x,
        pos.y,
        {},
      );
    }
  }

  spawnBlob(): void {
    const gs = this.tpf.getGameState();
    if (!gs || !this._player || !this._floorMap) return;
    const playerPos = this._player.pos;

    let spawnPos: { x: number; y: number } = this.getRandomSpawnPos();
    for (let i = 0; i < 10; i++) {
      spawnPos = this.getRandomSpawnPos();
      if (Math.abs(spawnPos.x - playerPos.x) + Math.abs(spawnPos.y - playerPos.y) > 256) {
        break;
      }
    }

    gs.spawnEntity(
      ((x: number, y: number, settings: Record<string, unknown>, context: EntityContext) => {
        settings = settings || {};
        settings.blobSpawnImage = this._enemyImages.blobSpawn;
        settings.blobSpawnDirectionsImage = this._enemyImages.blobSpawnDirections;
        settings.blobImage = this._enemyImages.blob;
        settings.blobGibImage = this._enemyImages.blobGib;
        settings.blobGibSound = this._sounds.blobGib;
        settings.player = this._player;
        settings.scene = this;
        settings.EntityEnemyBlob = (
          bx: number,
          by: number,
          bSettings: Record<string, unknown>,
          bContext: EntityContext,
        ) => {
          bSettings = bSettings || {};
          bSettings.blobImage = this._enemyImages.blob;
          bSettings.blobDirectionsImage = this._enemyImages.blobDirections;
          bSettings.blobGibImage = this._enemyImages.blobGib;
          bSettings.blobGibSound = this._sounds.blobGib;
          bSettings.player = this._player;
          bSettings.scene = this;
          bSettings.EntityEnemyBlobGib = (
            gx: number,
            gy: number,
            gSettings: Record<string, unknown>,
            gContext: EntityContext,
          ) => {
            gSettings = gSettings || {};
            gSettings.blobGibImage = this._enemyImages.blobGib;
            return new EntityEnemyBlobGib(gx, gy, gSettings, gContext);
          };
          // Directional in both B modes: with B off it shows one angle and steers like EntityEnemyBlob.
          return new EntityEnemyBlobDirectional(bx, by, bSettings, bContext);
        };
        return new EntityEnemyBlobSpawnerDirectional(x, y, settings, context);
      }) as unknown as new (x: number, y: number, s: Record<string, unknown>, c: EntityContext) => TPFEntity,
      spawnPos.x,
      spawnPos.y,
      {},
    );

    this._blobSpawnWaitCurrent /= this._blobSpawnWaitDiv;
    this._blobSpawnTimer = Math.max(this._blobSpawnWaitCurrent, 0.5);
  }

  update(time: number, delta: number): void {
    const inputController = this.tpf.getInputController();
    if (this._player && inputController && !this._dead && !this._deathAnimActive) {
      this._player._mouseDeltaX = inputController.consumeMouseDeltaX();
      this._player._mouseDown = inputController.mouseDown;
    }
    this.checkSpawn(delta / 1000);

    // Drive the demo-pulse material's animation. The TPFQuadBatch node re-applies material
    // uniforms on every activation (at least once per frame), so mutating the shared uniforms
    // object is all it takes; the program wrapper diff-checks, so this is free when G is off.
    this._pulseUniforms.time = time / 1000;
    if (this._gShaderOn) {
      // Sweep entities spawned since the G keypress so the effect persists (e.g. explosions).
      const entities = this.tpf.getGameState()?.entities || [];
      for (const entity of entities) {
        if (entity.tile && !entity.tile.quad.material) entity.setMaterial('demo-pulse');
      }
    }
  }
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.WEBGL,
  width: WIDTH,
  height: HEIGHT,
  parent: 'game',
  backgroundColor: '#000',
  scale: {
    // EXPAND pins one axis to the width/height above and grows the other to fill the parent, so the
    // internal resolution stays bounded (720 tall in a window wider than 16:9, 1280 wide in a narrower
    // one) while the aspect ratio follows the window. The engine picks the new size up through the
    // plugin's `viewchange` event.
    //   Phaser.Scale.FIT    - fixed WIDTH x HEIGHT buffer, letterboxed by CSS (the previous behaviour)
    //   Phaser.Scale.RESIZE - buffer matches the parent exactly; native sizing, unbounded fill cost
    // Neither EXPAND nor RESIZE accounts for devicePixelRatio: the buffer is sized in CSS pixels, so
    // a HiDPI display upscales. For native crispness use Scale.NONE with your own resize listener
    // calling game.scale.resize(cssWidth * dpr, cssHeight * dpr).
    mode: Phaser.Scale.EXPAND,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: {
    antialias: false,
    // Disable stencil so Phaser's off-screen framebuffers (used by world Filters) are color-only.
    // This is a WebGL1 context, where a separate depth renderbuffer cannot coexist with a stencil
    // attachment on one framebuffer; without this, attaching the world depth buffer (see
    // TpfExtern.render) leaves the filter framebuffer incomplete and the screen renders black.
    // The game uses no stencil-based features (Geometry masks), so this is safe.
    stencil: false,
    // Register the example wavy world filter's render node. The runtime uses the map value as the
    // node constructor directly (the RenderNodesConfig type is cast away to match that).
    renderNodes: { [WAVY_FILTER_NODE]: FilterWavyRenderNode } as unknown as Record<
      string,
      Phaser.Types.Core.RenderNodesConfig
    >,
  },
  plugins: {
    global: [{ key: 'TwoPointFivePlugin', plugin: TwoPointFivePlugin, start: true }],
  },
  scene: [MainScene],
};

const _game = new Phaser.Game(config);
