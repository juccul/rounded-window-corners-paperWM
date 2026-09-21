import assert from 'node:assert/strict';
import test from 'node:test';
import {Actor, runtime, settle} from './runtime.mjs';

const effectName = 'Rounded Corners Effect';

for (const [name, client] of [
    ['Wayland', 0],
    ['XWayland', 1],
]) {
    test(`${name}: rounds surface coordinates despite clipped window actor`, async () => {
        const r = await runtime();
        const {actor, surface} = r.window(client);
        actor.width = 400; // Parent allocation must not change surface bounds.
        actor.set_clip(300, 0, 400, 600);
        const manager = await r.importModule('src/manager/event_manager.ts');
        manager.enableEffect();
        await settle(actor);
        assert.equal(actor.get_effect(effectName), undefined);
        const effect = surface.get_effect(effectName);
        assert.deepEqual([...effect.uniforms.bounds], [10, 20, 790, 580]);
        assert.deepEqual([...effect.uniforms.pixelStep], [1 / 800, 1 / 600]);
        assert.deepEqual(actor.rwcCustomData.shadow.clip, [370, 60, 400, 600]);
        manager.disableEffect();
        assert.equal(surface.get_effect(effectName), undefined);
        assert.equal(actor.rwcCustomData, undefined);
        assert.equal(r.errors.length, 0);
    });
}

test('PaperWM shadow follows clone visibility, size and destruction', async () => {
    const r = await runtime();
    const {actor, win} = r.window();
    const selection = new Actor({name: 'selection'});
    const windowClone = new Actor({source: actor});
    const container = new Actor({cloneActor: windowClone});
    container.add_child(selection);
    container.add_child(windowClone);
    win.clone = container;
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    await settle(actor);
    const shadow = container.children[2];
    assert.equal(container.firstChild, selection);
    assert.equal(shadow.source, actor.rwcCustomData.shadow);
    // PaperWM reparents the selection on every focus transfer.
    container.remove_child(selection);
    container.add_child(selection);
    container.set_child_below_sibling(selection, windowClone);
    assert.equal(container.firstChild, selection);
    assert.deepEqual(
        [shadow.x, shadow.y, shadow.width, shadow.height],
        [-80, -80, 940, 720],
    );
    actor.visible = false;
    actor.emit('notify::visible');
    assert.equal(shadow.visible, true);
    windowClone.source = null;
    windowClone.emit('notify::source');
    assert.equal(shadow.visible, false);
    win.get_frame_rect = () => ({x: 0, y: 0, width: 400, height: 300});
    container.emit('notify::size');
    assert.deepEqual([shadow.width, shadow.height], [560, 460]);
    container.destroy();
    win.clone = null;
    assert.equal(actor.rwcCustomData.paperShadow, undefined);
    assert.equal(windowClone.signals.size, 0);
    manager.disableEffect();
    assert.equal(r.errors.length, 0);
});

test('discovers PaperWM enabled later and removes clones when disabled', async () => {
    const r = await runtime();
    const {actor, win} = r.window();
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    await settle(actor);
    const windowClone = new Actor({source: actor});
    win.clone = new Actor({cloneActor: windowClone});
    win.clone.add_child(windowClone);
    r.extensionManager.emit('extension-state-changed', {});
    assert.equal(win.clone.children.length, 2);
    manager.disableEffect();
    assert.deepEqual(win.clone.children, [windowClone]);
    assert.equal(windowClone.signals.size, 0);
});

test('pending app detection cannot recreate an effect after disable and re-enable', async () => {
    const r = await runtime();
    const {actor, win, surface} = r.window();
    delete win._appType;
    let resolveMaps;
    r.file.readFile = () =>
        new Promise(resolve => {
            resolveMaps = resolve;
        });
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    const pending = actor.rwcLock;
    manager.disableEffect();
    resolveMaps('');
    await pending;
    assert.equal(actor.rwcCustomData, undefined);
    assert.equal(surface.effects.size, 0);
    win._appType = 'Other';
    manager.enableEffect();
    await settle(actor);
    assert.ok(surface.get_effect(effectName));
    manager.disableEffect();
    assert.equal(r.errors.length, 0);
});

test('cleans up windows waiting for wm-class or surface and avoids duplicate map handlers', async () => {
    const r = await runtime();
    const {actor, win, surface} = r.window();
    win.wmClass = null;
    actor.remove_child(surface);
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    r.global.windowManager.emit('map', actor);
    manager.disableEffect();
    assert.equal(actor.signals.size, 0);
    assert.equal(win.signals.size, 0);
    actor.add_child(surface);
    win.wmClass = 'test';
    win.emit('notify::wm-class');
    assert.equal(actor.rwcCustomData, undefined);
    manager.enableEffect();
    r.global.windowManager.emit('map', actor);
    await settle(actor);
    assert.equal(surface.effects.size, 1);
    win.emit('unmanaging');
    assert.equal(actor.rwcCustomData, undefined);
    assert.equal(actor.signals.size, 0);
    manager.disableEffect();
});

test('fullscreen changes without resize remove and restore rounding', async () => {
    const r = await runtime();
    const {actor, win, surface} = r.window();
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    await settle(actor);
    win.fullscreen = true;
    win.emit('notify::fullscreen');
    await settle(actor);
    assert.equal(surface.effects.size, 0);
    win.fullscreen = false;
    win.emit('notify::fullscreen');
    await settle(actor);
    assert.equal(surface.effects.size, 1);
    manager.disableEffect();
});

test('shader clamps narrow windows and zero radius never produces NaN', async () => {
    const r = await runtime();
    const {RoundedCornersEffect} = await r.importModule(
        'src/effect/rounded_corners_effect.ts',
    );
    const effect = new RoundedCornersEffect();
    effect.actor = new Actor();
    effect.updateUniforms(
        {...r.config, borderRadius: 200, smoothing: 1},
        {x1: 10, y1: 20, x2: 50, y2: 120},
    );
    assert.equal(effect.uniforms.clipRadius[0], 20);
    effect.updateUniforms(
        {...r.config, borderRadius: 0},
        {x1: 0, y1: 0, x2: 800, y2: 600},
    );
    assert.equal(effect.uniforms.borderedAreaClipRadius[0], 0);
    for (const values of Object.values(effect.uniforms))
        assert.ok(values.every(Number.isFinite));
});

for (const blurFirst of [true, false]) {
    test(`Blur My Shell child is never rounded or tracked (blur first: ${blurFirst})`, async () => {
        const r = runtime();
        const {actor, surface} = r.window();
        const blur = new Actor({
            name: 'bms-application-blurred-widget',
            width: 1440,
            height: 900,
        });
        if (blurFirst) actor.insert_child_below(blur, surface);
        const manager = await r.importModule('src/manager/event_manager.ts');
        manager.enableEffect();
        await settle(actor);
        if (!blurFirst) {
            actor.insert_child_below(blur, surface);
            actor.emit('child-added', blur);
            await settle(actor);
        }
        assert.equal(actor.rwcCustomData.effectActor, surface);
        assert.equal(blur.effects.size, 0);
        assert.equal(blur.signals.size, 0);
        assert.deepEqual(
            [...surface.get_effect(effectName).uniforms.bounds],
            [10, 20, 790, 580],
        );
        blur.destroy();
        actor.emit('child-removed', blur);
        await settle(actor);
        assert.equal(actor.rwcCustomData.effectActor, surface);
        manager.disableEffect();
        assert.equal(r.errors.length, 0);
    });
}

test('waits for a real surface when only a blur actor exists', async () => {
    const r = runtime();
    const {actor, surface} = r.window();
    actor.remove_child(surface);
    actor.add_child(new Actor({name: 'bms-application-blurred-widget'}));
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    await settle(actor);
    assert.equal(actor.rwcCustomData, undefined);
    actor.add_child(surface);
    actor.emit('child-added', surface);
    await settle(actor);
    assert.equal(actor.rwcCustomData.effectActor, surface);
    manager.disableEffect();
});

test('surface replacement disconnects old objects before disposal', async () => {
    const r = runtime();
    const {actor, surface} = r.window();
    const manager = await r.importModule('src/manager/event_manager.ts');
    manager.enableEffect();
    await settle(actor);
    surface.destroy();
    const replacement = new Actor({
        typeName: 'MetaSurfaceContainerActorWayland',
    });
    actor.add_child(replacement);
    actor.emit('child-added', replacement);
    await settle(actor);
    assert.equal(actor.rwcCustomData.effectActor, replacement);
    manager.disableEffect();
    assert.equal(r.errors.length, 0);
});

for (const blurFirst of [true, false]) {
    test(`PaperWM clones retain BMS blur across visibility handoff (blur first: ${blurFirst})`, async () => {
        const r = runtime();
        const {actor, surface} = r.window();
        const blur = new Actor({name: 'bms-application-blurred-widget'});
        actor.insert_child_below(blur, surface);
        const windowClone = new Actor({source: actor});
        actor.metaWindow.clone = new Actor({cloneActor: windowClone});
        actor.metaWindow.clone.add_child(windowClone);
        const connectBms = () =>
            actor.connect('notify::visible', () => {
                if (actor.visible) blur.show();
                else blur.hide();
            });
        if (blurFirst) connectBms();
        const manager = await r.importModule('src/manager/event_manager.ts');
        manager.enableEffect();
        await settle(actor);
        if (!blurFirst) connectBms();
        actor.hide();
        assert.equal(blur.visible, true);
        assert.equal(actor.visible, false);
        assert.equal(blur.effects.size, 0);
        windowClone.hide();
        assert.equal(blur.visible, false);
        actor.show();
        assert.equal(blur.visible, true);
        // A blur intentionally hidden while the window is visible stays hidden.
        blur.hide();
        windowClone.show();
        actor.hide();
        assert.equal(blur.visible, false);
        // BMS may destroy and replace its layer while rounding is still active.
        blur.destroy();
        actor.emit('child-removed', blur);
        manager.disableEffect();
        assert.equal(r.errors.length, 0);
    });
}
