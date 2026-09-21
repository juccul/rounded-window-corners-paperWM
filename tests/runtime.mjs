import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const jsExtension = /\.js$/;

export class Actor {
    signals = new Map();
    children = [];
    constraints = [];
    effects = new Map();
    /** @type {boolean} */
    visible = Boolean(1);
    width = 800;
    height = 600;
    opacity = 255;
    x = 0;
    y = 0;
    style = '';
    nextId = 1;
    constructor(props = {}) {
        Object.assign(this, props);
        this.constructor = {$gtype: props.typeName ?? 'ClutterActor'};
        if (props.child) this.add_child(props.child);
    }
    connect(signal, callback) {
        const id = this.nextId++;
        this.signals.set(id, {signal, callback});
        return id;
    }
    connect_after(signal, callback) {
        const id = this.connect(signal, callback);
        this.signals.get(id).after = true;
        return id;
    }
    show() {
        if (!this.visible) {
            this.visible = true;
            this.emit('notify::visible');
        }
    }
    hide() {
        if (this.visible) {
            this.visible = false;
            this.emit('notify::visible');
        }
    }
    disconnect(id) {
        if (this.destroyed) throw new Error('Access to disposed actor');
        this.signals.delete(id);
    }
    emit(signal, ...args) {
        for (const [id, entry] of [...this.signals].sort(
            (a, b) => Number(Boolean(a[1].after)) - Number(Boolean(b[1].after)),
        )) {
            if (entry.signal === signal && this.signals.has(id))
                entry.callback(this, ...args);
        }
    }
    get firstChild() {
        return this.children[0] ?? null;
    }
    get_children() {
        return [...this.children];
    }
    get_first_child() {
        return this.firstChild;
    }
    get_parent() {
        return this.parent ?? null;
    }
    add_child(child) {
        this.insert_child_below(child, null);
    }
    insert_child_below(child, sibling) {
        child.parent = this;
        const index = sibling
            ? this.children.indexOf(sibling)
            : this.children.length;
        this.children.splice(index, 0, child);
    }
    insert_child_above(child, sibling) {
        child.parent = this;
        this.children.splice(this.children.indexOf(sibling) + 1, 0, child);
    }
    remove_child(child) {
        this.children.splice(this.children.indexOf(child), 1);
        child.parent = null;
    }
    set_child_below_sibling(child, sibling) {
        this.remove_child(child);
        this.insert_child_below(child, sibling);
    }
    set_position(x, y) {
        Object.assign(this, {x, y});
    }
    set_size(width, height) {
        Object.assign(this, {width, height});
    }
    get_width() {
        return this.width;
    }
    get_height() {
        return this.height;
    }
    set_clip(...clip) {
        this.clip = clip;
        this.has_clip = true;
    }
    get_clip() {
        return this.clip;
    }
    remove_clip() {
        this.has_clip = false;
    }
    add_constraint(c) {
        this.constraints.push(c);
    }
    get_constraints() {
        return this.constraints;
    }
    remove_constraint(c) {
        this.constraints = this.constraints.filter(v => v !== c);
    }
    add_effect_with_name(name, effect) {
        effect.actor = this;
        this.effects.set(name, effect);
    }
    get_effect(name) {
        return this.effects.get(name);
    }
    remove_effect_by_name(name) {
        this.effects.delete(name);
    }
    clear_effects() {
        this.effects.clear();
    }
    add_style_class_name() {
        /* Rendering is not needed by the signal/geometry test double. */
    }
    queue_redraw() {
        /* Rendering is not needed by the signal/geometry test double. */
    }
    bind_property(from, target, to) {
        target[to] = this[from];
        const id = this.connect(`notify::${from}`, () => {
            target[to] = this[from];
        });
        return {unbind: () => this.disconnect(id)};
    }
    destroy() {
        if (this.destroyed) throw new Error('Actor destroyed twice');
        this.emit('destroy');
        for (const child of [...this.children]) child.destroy();
        this.parent?.remove_child(this);
        this.destroyed = true;
    }
}

export function runtime() {
    const config = {
        borderRadius: 12,
        smoothing: 0,
        padding: {left: 0, right: 0, top: 0, bottom: 0},
        borderColor: [1, 1, 1, 1],
        keepRoundedCorners: {maximized: false, fullscreen: false},
    };
    const settings = {
        'global-rounded-corner-settings': config,
        'custom-rounded-corner-settings': {},
        blacklist: [],
        whitelist: false,
        'border-width': 0,
        'focused-shadow': {},
        'unfocused-shadow': {},
    };
    const global = {
        windowGroup: new Actor(),
        display: new Actor(),
        windowManager: new Actor(),
        actors: [],
        get_window_actors() {
            return this.actors;
        },
    };
    const prefs = new Actor();
    const extensionManager = new Actor();
    const errors = [];
    const timeouts = new Map();
    let nextTimeout = 1;
    const file = {readFile: async () => '', readShader: async () => ['', '']};
    class Effect {
        uniforms = {};
        enabled = true;
        get_uniform_location(name) {
            return name;
        }
        set_uniform_float(name, _size, value) {
            this.uniforms[name] = value;
        }
        queue_repaint() {
            /* Rendering is not needed by the signal/geometry test double. */
        }
    }
    const mocks = {
        'gi://Clutter': {
            default: {
                Actor,
                Clone: Actor,
                BindConstraint: class {
                    constructor(props) {
                        Object.assign(this, props);
                    }
                },
            },
        },
        'gi://St': {default: {Bin: Actor}},
        'gi://GObject': {
            default: {
                registerClass: (_metadata, klass) => klass,
                type_name: type => type,
                BindingFlags: {SYNC_CREATE: 1},
            },
        },
        'gi://Cogl': {default: {}},
        'gi://Shell': {default: {GLSLEffect: Effect}},
        'gi://Gio': {default: {}},
        'gi://Meta': {
            default: {
                WindowType: {NORMAL: 0, DIALOG: 1, MODAL_DIALOG: 2},
                WindowClientType: {X11: 1, WAYLAND: 0},
            },
        },
        'gi://GLib': {
            default: {
                PRIORITY_DEFAULT: 0,
                SOURCE_REMOVE: false,
                timeout_add: (_priority, _delay, fn) => {
                    const id = nextTimeout++;
                    timeouts.set(id, fn);
                    return id;
                },
                source_remove: id => {
                    if (!timeouts.delete(id))
                        throw new Error('Stale timeout removed');
                },
            },
        },
        'resource:///org/gnome/shell/ui/main.js': {extensionManager},
        [resolve('src/utils/file.ts')]: file,
        [resolve('src/utils/settings.ts')]: {
            prefs,
            getPref: key => settings[key],
        },
        [resolve('src/utils/log.ts')]: {
            logDebug() {
                /* Rendering is not needed by the signal/geometry test double. */
            },
            logError: error => errors.push(error),
        },
        [resolve('src/utils/box_shadow.ts')]: {boxShadowCss: () => ''},
    };
    const context = vm.createContext({global, console});
    const modules = new Map();
    function load(id) {
        if (modules.has(id)) return modules.get(id);
        const pending = loadModule(id);
        modules.set(id, pending);
        return pending;
    }
    async function loadModule(id) {
        let mod;
        if (mocks[id]) {
            const values = mocks[id];
            mod = new vm.SyntheticModule(
                Object.keys(values),
                function () {
                    for (const [key, value] of Object.entries(values))
                        this.setExport(key, value);
                },
                {context},
            );
        } else {
            const code = ts.transpileModule(await readFile(id, 'utf8'), {
                compilerOptions: {
                    target: ts.ScriptTarget.ES2022,
                    module: ts.ModuleKind.ESNext,
                },
            }).outputText;
            mod = new vm.SourceTextModule(code, {context, identifier: id});
        }
        await mod.link((specifier, parent) =>
            load(
                specifier.startsWith('.')
                    ? resolve(
                          parent.identifier,
                          '..',
                          specifier.replace(jsExtension, '.ts'),
                      )
                    : specifier,
            ),
        );
        return mod;
    }
    async function importModule(path) {
        const mod = await load(resolve(path));
        if (mod.status !== 'evaluated') await mod.evaluate();
        return mod.namespace;
    }
    function window(client = 0) {
        const win = new Actor({
            wmClass: 'non-gtk-test',
            windowType: 0,
            fullscreen: false,
            _appType: 'Other',
        });
        win.get_client_type = () => client;
        win.get_pid = () => 123;
        win.get_frame_rect = () => ({x: 110, y: 120, width: 780, height: 560});
        win.get_buffer_rect = () => ({x: 100, y: 100, width: 800, height: 600});
        const surface = new Actor({
            typeName:
                client === 0
                    ? 'MetaSurfaceContainerActorWayland'
                    : 'MetaSurfaceActorWayland',
        });
        const texture = new Actor();
        const actor = new Actor({metaWindow: win, child: surface});
        actor.get_texture = () => texture;
        win.get_compositor_private = () => actor;
        global.actors.push(actor);
        global.windowGroup.add_child(actor);
        return {actor, win, surface, texture};
    }
    return {
        importModule,
        settings,
        config,
        global,
        prefs,
        extensionManager,
        errors,
        file,
        window,
        timeouts,
    };
}

export async function settle(actor) {
    // biome-ignore lint/performance/noAwaitInLoops: Drain sequential actor work, including work queued by callbacks.
    while (actor.rwcLock) await actor.rwcLock;
}
