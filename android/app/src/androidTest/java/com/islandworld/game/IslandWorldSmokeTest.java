package com.islandworld.game;

import static org.junit.Assert.*;

import android.app.Instrumentation;
import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.PointF;
import android.os.Bundle;
import android.os.Handler;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.MotionEvent;
import android.view.inputmethod.EditorInfo;
import android.view.inputmethod.InputConnection;
import android.view.inputmethod.InputMethodManager;
import android.webkit.WebView;

import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.filters.LargeTest;
import androidx.test.platform.app.InstrumentationRegistry;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Runs against the actual bundled game and Android WebView, not a mocked page. */
@RunWith(AndroidJUnit4.class)
@LargeTest
public class IslandWorldSmokeTest {
    private final Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
    private ActivityScenario<MainActivity> scenario;

    @Test
    public void diagnoseNativeHost() throws Exception {
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            scenario = activity;
            long deadline = SystemClock.uptimeMillis() + 15_000;
            JSONObject diagnostics = new JSONObject();
            do {
                try {
                    diagnostics = evaluate("(() => {const cap=globalThis.Capacitor;"
                            + "return {origin:location.origin,title:document.title,ready:document.readyState,"
                            + "nativeHost:document.body?.dataset.nativeHost??null,"
                            + "nativeHostError:document.body?.dataset.nativeHostError??null,"
                            + "nativeAppState:document.body?.dataset.nativeAppState??null,"
                            + "platform:cap?.getPlatform?.()??null,native:cap?.isNativePlatform?.()??false,"
                            + "appAvailable:cap?.isPluginAvailable?.('App')??null,"
                            + "canvas:!!document.querySelector('#game canvas'),"
                            + "menu:!!document.getElementById('start-button'),"
                            + "loading:document.getElementById('loading-detail')?.textContent??null,"
                            + "resources:performance.getEntriesByType('resource').filter(e=>/\\.js($|\\?)/.test(e.name))"
                            + ".map(e=>({name:e.name,status:e.responseStatus??null,duration:e.duration}))};})()");
                    if ("ready".equals(diagnostics.optString("nativeHost"))) break;
                } catch (Exception failure) {
                    diagnostics = new JSONObject();
                    diagnostics.put("evaluationError", failure.toString());
                }
                SystemClock.sleep(250);
            } while (SystemClock.uptimeMillis() < deadline);
            AtomicReference<Boolean> nativePlugin = new AtomicReference<>(false);
            scenario.onActivity(host -> nativePlugin.set(host.getBridge().getPlugin("App") != null));
            diagnostics.put("nativeBridgeAppPlugin", nativePlugin.get());
            diagnostics.put("webView", webViewGeometry());
            writeJsonReport("islandworld-native-host-diagnostics.json", diagnostics, "native_host");
            saveScreenshot("islandworld-native-host-diagnostics.png");
            assertEquals("https://localhost", diagnostics.optString("origin"));
            assertEquals("android", diagnostics.optString("platform"));
            assertTrue(diagnostics.optBoolean("native"));
            assertTrue(diagnostics.optBoolean("canvas"));
            assertTrue(diagnostics.optBoolean("menu"));
            assertTrue(diagnostics.getBoolean("nativeBridgeAppPlugin"));
            assertEquals("Native App callbacks must finish registering: " + diagnostics,
                    "ready", diagnostics.optString("nativeHost"));
        } finally { scenario = null; }
    }

    @Test
    public void bundledWorldHasTouchControlsSecureNetworkingAndNativeLifecycle() throws Exception {
        verifyBundledProductionServer();
        try (ActivityScenario<MainActivity> activity = ActivityScenario.launch(MainActivity.class)) {
            scenario = activity;
            try {
            waitFor("bundled world load", "document.body.classList.contains('native-android')"
                    + " && !!document.querySelector('#game canvas')"
                    + " && document.getElementById('loading').hidden"
                    + " && document.body.dataset.nativeAppState === 'active'"
                    + " && document.body.dataset.nativeHost === 'ready'", 180_000);
            JSONObject initial = evaluate("({origin:location.origin,title:document.title,"
                    + "secure:window.isSecureContext,native:Capacitor.isNativePlatform(),"
                    + "platform:Capacitor.getPlatform(),landscape:innerWidth>innerHeight,"
                    + "touch:document.body.classList.contains('touch-ui'),"
                    + "menu:!document.getElementById('screen').hidden,"
                    + "width:document.querySelector('#game canvas').width,"
                    + "height:document.querySelector('#game canvas').height,"
                    + "roomEnabled:!document.getElementById('room-create').disabled})");
            assertEquals("https://localhost", initial.getString("origin"));
            assertEquals("Island World", initial.getString("title"));
            assertEquals("android", initial.getString("platform"));
            assertTrue(initial.getBoolean("secure"));
            assertTrue(initial.getBoolean("native"));
            assertTrue(initial.getBoolean("landscape"));
            assertTrue(initial.getBoolean("touch"));
            assertTrue(initial.getBoolean("menu"));
            assertTrue(initial.getBoolean("roomEnabled"));
            assertTrue(initial.getInt("width") >= 600);
            assertTrue(initial.getInt("height") >= 300);

            JSONObject graphics = evaluate("(() => {const canvas=document.querySelector('#game canvas');"
                    + "const gl=canvas.getContext('webgl2');return {webgl2:!!gl,"
                    + "lost:gl?gl.isContextLost():true,"
                    + "recovery:[...document.querySelectorAll('.graphics-recovery')].some(e=>!e.hidden)};})()");
            assertTrue("The real island requires a working WebGL2 canvas", graphics.getBoolean("webgl2"));
            assertFalse(graphics.getBoolean("lost"));
            assertFalse(graphics.getBoolean("recovery"));
            // Use the shipped weather/time settings so texture and controller
            // screenshots are readable. The complete authored world is loaded.
            evaluate("(() => {for(const [id,value] of [['weather-select','clear'],['time-select','noon']]){"
                    + "const control=document.getElementById(id);control.value=value;"
                    + "control.dispatchEvent(new Event('change',{bubbles:true}));}return {configured:true};})()");

            tapElement("start-button");
            waitFor("native gameplay HUD", "document.getElementById('screen').hidden"
                    + " && !document.getElementById('hud').hidden"
                    + " && !document.getElementById('touch-controls').hidden", 15_000);
            assertTrue(evaluate("({present:!!document.getElementById('touch-stick')"
                    + "&&!!document.getElementById('touch-look')"
                    + "&&!!document.getElementById('touch-sprint')"
                    + "&&!!document.getElementById('combat-aim')"
                    + "&&!!document.getElementById('combat-fire')})").getBoolean("present"));
            tapElement("touch-sprint");
            waitFor("sprint toggle", "document.getElementById('touch-sprint').getAttribute('aria-pressed')==='true'", 5_000);
            tapElement("touch-sprint");
            waitFor("sprint release", "document.getElementById('touch-sprint').getAttribute('aria-pressed')==='false'", 5_000);
            JSONObject movementBefore = readPlayerMapPosition();
            // Shoot into open sky so an unrelated resident near South Landing
            // is neither injured nor alerted during these control checks.
            lookVertically(true);
            assertTrue(evaluate("({ammo:document.querySelector('#combat-ammo strong').textContent})")
                    .getString("ammo").matches("6\\s*/\\s*36"));
            verifyConcurrentTouchCombat();
            tapElement("combat-aim");
            waitFor("aim release", "document.getElementById('combat-aim').getAttribute('aria-pressed')==='false'", 5_000);
            lookVertically(false);
            JSONObject movementAfter = readPlayerMapPosition();
            assertTrue("Held movement must change the rendered map player marker",
                    Math.hypot(movementAfter.getDouble("x") - movementBefore.getDouble("x"),
                            movementAfter.getDouble("y") - movementBefore.getDouble("y")) > 0.4);
            tapElement("combat-wheel");
            waitFor("mobile weapon wheel", "getComputedStyle(document.querySelector('[aria-label=\"Equipment wheel\"]')).display!=='none'", 5_000);
            tapSelector("button[aria-label='Select rifle, slot 2']");
            waitFor("rifle selected from wheel", "document.getElementById('combat-ammo').textContent.includes('HUNTING RIFLE')"
                    + " && getComputedStyle(document.querySelector('[aria-label=\"Equipment wheel\"]')).display==='none'", 5_000);
            tapElement("combat-wheel");
            waitFor("wheel reopened", "getComputedStyle(document.querySelector('[aria-label=\"Equipment wheel\"]')).display!=='none'", 5_000);
            tapSelector("button[aria-label='Select revolver, slot 1']");
            waitFor("revolver restored", "document.getElementById('combat-ammo').textContent.includes('SERVICE REVOLVER')", 5_000);
            saveScreenshot("islandworld-android-gameplay.png");
            measureFrameCadence();
            assertEquals("Control checks must not provoke or injure residents",
                    "100", evaluate("({health:document.querySelector('#combat-health [aria-label=\"Health\"]').getAttribute('aria-valuenow')})")
                    .getString("health"));

            performNativeBack();
            waitFor("Android Back opens pause menu", "!document.getElementById('screen').hidden"
                    + " && document.getElementById('touch-controls').hidden"
                    + " && document.body.dataset.nativeBackAction==='menu'", 5_000);
            performNativeBack();
            waitFor("Android Back resumes gameplay", "document.getElementById('screen').hidden"
                    + " && !document.getElementById('touch-controls').hidden"
                    + " && document.body.dataset.nativeBackAction==='resume'", 5_000);
            tapElement("touch-more");
            waitFor("additional mobile controls", "!document.getElementById('touch-tools').hidden", 5_000);
            tapSelector("button[data-touch-action='map']");
            waitFor("mobile map", "!document.getElementById('map-panel').hidden"
                    + " && document.getElementById('touch-controls').hidden", 5_000);
            performNativeBack();
            waitFor("Android Back closes map before leaving play", "document.getElementById('map-panel').hidden"
                    + " && document.getElementById('screen').hidden"
                    + " && !document.getElementById('touch-controls').hidden"
                    + " && document.body.dataset.nativeBackAction==='map'", 5_000);
            Bundle backReport = new Bundle();
            backReport.putString("back_validation", "AppPlugin dispatcher callbacks: menu/resume/map; physical system gesture not tested");
            instrumentation.sendStatus(0, backReport);

            scenario.moveToState(Lifecycle.State.CREATED);
            scenario.moveToState(Lifecycle.State.RESUMED);
            waitFor("foreground stays safely paused", "document.body.dataset.nativeAppState==='paused'"
                    + " && !document.getElementById('screen').hidden"
                    + " && document.getElementById('touch-controls').hidden", 10_000);
            tapElement("start-button");
            waitFor("explicit Resume restarts the game", "document.body.dataset.nativeAppState==='active'"
                    + " && document.getElementById('screen').hidden"
                    + " && !document.getElementById('touch-controls').hidden", 10_000);
            assertFalse(evaluate("({lost:document.querySelector('#game canvas').getContext('webgl2').isContextLost()})")
                    .getBoolean("lost"));
            verifyNativeIme();

            // Optionally join a browser-created QA room, using only the shipped
            // room UI. A second identity must already be present in that room.
            String joinCode = InstrumentationRegistry.getArguments().getString("joinCode", "");
            if (!joinCode.isEmpty()) verifyBrowserRoom(joinCode);
            saveScreenshot("islandworld-android-validated.png");
            } catch (Exception | AssertionError failure) {
                try { saveScreenshot("islandworld-android-failure.png"); }
                catch (Throwable screenshotFailure) { failure.addSuppressed(screenshotFailure); }
                throw failure;
            }
        } finally { scenario = null; }
    }

    private void verifyBundledProductionServer() throws Exception {
        String html = readAsset("public/index.html");
        Matcher entry = Pattern.compile("src=\"/?(assets/[^\"]+\\.js)\"").matcher(html);
        assertTrue("Production JavaScript entry must be bundled", entry.find());
        String javascript = readAsset("public/" + entry.group(1));
        assertTrue("APK must connect to the existing public HTTPS server",
                javascript.contains("https://islandworld-room-server.onrender.com"));
        assertFalse("Development-only combat controls must not ship", javascript.contains("test=night_lamps"));
    }

    private String readAsset(String path) throws Exception {
        try (InputStream input = instrumentation.getTargetContext().getAssets().open(path);
             ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) != -1) bytes.write(buffer, 0, count);
            return bytes.toString(StandardCharsets.UTF_8.name());
        }
    }

    private JSONObject evaluate(String expression) throws Exception {
        CountDownLatch complete = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(
                expression, value -> { result.set(value); complete.countDown(); }));
        assertTrue("WebView JavaScript callback timed out during startup/model loading",
                complete.await(45, TimeUnit.SECONDS));
        assertNotNull(result.get());
        return new JSONObject(result.get());
    }

    private void waitFor(String label, String condition, long timeout) throws Exception {
        long deadline = SystemClock.uptimeMillis() + timeout;
        JSONObject latest = new JSONObject();
        do {
            latest = evaluate("(() => {try{return {ok:Boolean(" + condition + "),"
                    + "detail:document.getElementById('loading-detail')?.textContent,"
                    + "origin:location.origin,ready:document.readyState,"
                    + "nativeHost:document.body?.dataset.nativeHost,"
                    + "nativeHostError:document.body?.dataset.nativeHostError,"
                    + "nativeAppState:document.body?.dataset.nativeAppState};}catch(error){"
                    + "return {ok:false,error:String(error),origin:location.origin};}})()");
            if (latest.optBoolean("ok")) return;
            SystemClock.sleep(300);
        } while (SystemClock.uptimeMillis() < deadline);
        fail(label + " timed out: " + latest);
    }

    private void tapElement(String id) throws Exception {
        tapSelector("#" + id);
    }

    private void tapSelector(String selector) throws Exception {
        PointF point = pointForSelector(selector);
        long downTime = SystemClock.uptimeMillis();
        MotionEvent down = fingerMotionEvent(downTime, MotionEvent.ACTION_DOWN, point.x, point.y);
        try {
            instrumentation.sendPointerSync(down);
            SystemClock.sleep(80);
            MotionEvent up = fingerMotionEvent(downTime, MotionEvent.ACTION_UP, point.x, point.y);
            try { instrumentation.sendPointerSync(up); } finally { up.recycle(); }
        } finally { down.recycle(); }
    }

    private PointF pointForSelector(String selector) throws Exception {
        JSONObject rectangle = evaluate("(() => {const el=document.querySelector(" + JSONObject.quote(selector)
                + ");el.scrollIntoView({block:'center',inline:'center'});const r=el.getBoundingClientRect();"
                + "const x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);"
                + "return {x,y,width:r.width,height:r.height,viewportWidth:innerWidth,"
                + "hittable:el.contains(hit),hit:hit?.id??hit?.tagName};})()");
        assertTrue("Touch target has no layout: " + selector, rectangle.getDouble("width") > 0);
        assertTrue("Touch target is covered by " + rectangle.optString("hit") + ": " + selector,
                rectangle.getBoolean("hittable"));
        final int[] offset = new int[2];
        final int[] viewWidth = new int[1];
        scenario.onActivity(activity -> {
            WebView view = activity.getBridge().getWebView();
            view.getLocationOnScreen(offset);
            viewWidth[0] = view.getWidth();
        });
        float cssToScreen = viewWidth[0] / (float) rectangle.getDouble("viewportWidth");
        float x = offset[0] + (float) rectangle.getDouble("x") * cssToScreen;
        float y = offset[1] + (float) rectangle.getDouble("y") * cssToScreen;
        if ("#combat-aim".equals(selector)) {
            JSONObject mapping = new JSONObject();
            mapping.put("target", selector);
            mapping.put("css", rectangle);
            mapping.put("view", webViewGeometry());
            mapping.put("injectedX", x); mapping.put("injectedY", y);
            writeJsonReport("islandworld-android-touch-mapping.json", mapping, "native_touch_mapping");
        }
        return new PointF(x, y);
    }

    private JSONObject webViewGeometry() throws Exception {
        final int[] metrics = new int[8];
        scenario.onActivity(activity -> {
            WebView view = activity.getBridge().getWebView();
            int[] position = new int[2]; view.getLocationOnScreen(position);
            metrics[0] = view.getWidth(); metrics[1] = view.getHeight();
            metrics[2] = view.getPaddingLeft(); metrics[3] = view.getPaddingTop();
            metrics[4] = view.getPaddingRight(); metrics[5] = view.getPaddingBottom();
            metrics[6] = position[0]; metrics[7] = position[1];
        });
        JSONObject result = new JSONObject();
        String[] names = {"width","height","paddingLeft","paddingTop","paddingRight","paddingBottom","screenX","screenY"};
        for (int index = 0; index < names.length; index++) result.put(names[index], metrics[index]);
        JSONObject viewport = evaluate("({width:innerWidth,height:innerHeight,pixelRatio:devicePixelRatio})");
        result.put("viewport", viewport);
        return result;
    }

    private void verifyBrowserRoom(String code) throws Exception {
        performNativeBack();
        waitFor("room menu", "!document.getElementById('screen').hidden", 5_000);
        evaluate("(() => {document.getElementById('private-room-panel').open=true;"
                + ";return {ok:true};})()");
        enterNativeText("room-player-name", "Android QA");
        enterNativeText("room-code-input", code.toUpperCase());
        hideNativeKeyboard();
        tapElement("room-join");
        waitFor("Android/browser shared room", "!document.getElementById('room-online-view').hidden"
                + " && document.querySelectorAll('#room-player-list li').length>=2", 45_000);
        SystemClock.sleep(2_000);
        JSONObject stable = evaluate("({online:!document.getElementById('room-online-view').hidden,"
                + "count:document.querySelectorAll('#room-player-list li').length,"
                + "status:document.getElementById('room-status').textContent})");
        assertTrue("Shared room must remain joined after two seconds", stable.getBoolean("online"));
        assertTrue("Both independent identities must remain in the room", stable.getInt("count") >= 2);
        assertEquals("Connected", stable.getString("status"));
        JSONObject room = evaluate("({code:document.getElementById('room-code-label').textContent,"
                + "players:document.getElementById('room-player-list').textContent,"
                + "status:document.getElementById('room-status').textContent})");
        assertTrue(room.getString("code").contains(code.toUpperCase()));
        assertTrue(room.getString("players").contains("Android QA (you)"));
        assertEquals("Connected", room.getString("status"));
        saveScreenshot("islandworld-android-browser-room.png");
        tapElement("room-leave");
        waitFor("native room cleanup", "document.getElementById('room-online-view').hidden", 10_000);
    }

    private JSONObject readPlayerMapPosition() throws Exception {
        tapElement("touch-more");
        waitFor("map tool visible", "!document.getElementById('touch-tools').hidden", 5_000);
        tapSelector("button[data-touch-action='map']");
        waitFor("player position map", "!document.getElementById('map-panel').hidden", 5_000);
        JSONObject position = evaluate("(() => {const p=document.querySelector('#map-content circle[fill=\"#fff4c5\"]');"
                + "return {x:Number(p.getAttribute('cx')),y:Number(p.getAttribute('cy'))};})()");
        performNativeBack();
        waitFor("map returns to live controls", "document.getElementById('map-panel').hidden"
                + " && !document.getElementById('touch-controls').hidden", 5_000);
        return position;
    }

    private void verifyConcurrentTouchCombat() throws Exception {
        PointF stick = pointForSelector("#touch-stick");
        PointF sprint = pointForSelector("#touch-sprint");
        PointF aim = pointForSelector("#combat-aim");
        PointF fire = pointForSelector("#combat-fire");
        PointF reload = pointForSelector("#combat-reload");
        JSONObject route = safeLookRoute();
        PointF look = nativePoint(route.getDouble("x"),
                (route.getDouble("top") + route.getDouble("bottom")) * 0.5,
                route.getDouble("viewportWidth"));
        float scale = (float) (webViewGeometry().getDouble("width") / route.getDouble("viewportWidth"));
        evaluate("(() => {delete document.body.dataset.nativeSmokeSecondaryLook;"
                + "document.getElementById('touch-look').addEventListener('pointermove',event=>{"
                + "document.body.dataset.nativeSmokeSecondaryLook=String(event.pointerType==='touch'&&!event.isPrimary);"
                + "},{once:true});return {observing:true};})()");
        try (NativeTouchSession fingers = new NativeTouchSession()) {
            fingers.down(0, stick);
            fingers.move(0, new PointF(stick.x, stick.y - 40f * scale));
            fingers.down(1, look);
            fingers.move(1, new PointF(look.x + 8f * scale, look.y));
            waitFor("secondary look finger during held movement",
                    "document.body.dataset.nativeSmokeSecondaryLook==='true'", 5_000);
            fingers.tap(2, sprint);
            waitFor("sprint while movement and look fingers remain down",
                    "document.getElementById('touch-sprint').getAttribute('aria-pressed')==='true'", 5_000);
            waitFor("sprinting consumes actual stamina",
                    "Number(document.getElementById('stamina-meter').getAttribute('aria-valuenow'))<100", 5_000);
            fingers.tap(2, aim);
            waitFor("AIM activates with two other fingers held",
                    "document.getElementById('combat-aim').getAttribute('aria-pressed')==='true'", 5_000);
            fingers.tap(2, fire);
            waitFor("FIRE works while moving and looking with AIM latched",
                    "/^5\\s*\\//.test(document.querySelector('#combat-ammo strong').textContent)"
                            + " && document.getElementById('combat-aim').getAttribute('aria-pressed')==='true'", 5_000);
            // Retain both contacts but center movement while waiting for the
            // reload animation, so the test cannot wander into a cliff.
            fingers.move(0, stick);
            fingers.move(1, look);
            fingers.tap(2, reload);
            waitFor("RELOAD works with other fingers held",
                    "document.getElementById('combat-ammo').textContent.includes('RELOADING')", 5_000);
            waitFor("reload finishes without clearing latched AIM",
                    "/^6\\s*\\/\\s*35$/.test(document.querySelector('#combat-ammo strong').textContent)"
                            + " && document.getElementById('combat-aim').getAttribute('aria-pressed')==='true'", 10_000);
        }
        waitFor("releasing other fingers does not clear AIM",
                "document.getElementById('combat-aim').getAttribute('aria-pressed')==='true'", 5_000);
        if (evaluate("({sprint:document.getElementById('touch-sprint').getAttribute('aria-pressed')==='true'})")
                .getBoolean("sprint")) tapElement("touch-sprint");
        JSONObject report = new JSONObject();
        report.put("simultaneousPointers", 3);
        report.put("secondaryLook", true);
        report.put("sprintWhileMoving", true);
        report.put("aimWhileMoving", true);
        report.put("aimedFireWhileMoving", true);
        report.put("reloadWithOtherContacts", true);
        report.put("aimSurvivesOtherPointerRelease", true);
        writeJsonReport("islandworld-android-multitouch.json", report, "native_multitouch");
        evaluate("(() => {delete document.body.dataset.nativeSmokeSecondaryLook;return {removed:true};})()");
    }

    /** Constructs real Android multi-pointer streams with independent IDs. */
    private final class NativeTouchSession implements AutoCloseable {
        private final ArrayList<Integer> ids = new ArrayList<>();
        private final ArrayList<PointF> points = new ArrayList<>();
        private long downTime;

        void down(int id, PointF point) {
            assertFalse(ids.contains(id));
            if (ids.isEmpty()) downTime = SystemClock.uptimeMillis();
            ids.add(id); points.add(new PointF(point.x, point.y));
            send(ids.size() == 1 ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_POINTER_DOWN
                    | ((ids.size() - 1) << MotionEvent.ACTION_POINTER_INDEX_SHIFT));
        }

        void move(int id, PointF point) {
            int index = ids.indexOf(id);
            assertTrue(index >= 0);
            points.set(index, new PointF(point.x, point.y));
            send(MotionEvent.ACTION_MOVE);
        }

        void up(int id) {
            int index = ids.indexOf(id);
            assertTrue(index >= 0);
            send(ids.size() == 1 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_POINTER_UP
                    | (index << MotionEvent.ACTION_POINTER_INDEX_SHIFT));
            ids.remove(index); points.remove(index);
        }

        void tap(int id, PointF point) {
            down(id, point); SystemClock.sleep(90); up(id);
        }

        private void send(int action) {
            MotionEvent.PointerProperties[] properties = new MotionEvent.PointerProperties[ids.size()];
            MotionEvent.PointerCoords[] coordinates = new MotionEvent.PointerCoords[ids.size()];
            for (int index = 0; index < ids.size(); index++) {
                properties[index] = new MotionEvent.PointerProperties();
                properties[index].id = ids.get(index);
                properties[index].toolType = MotionEvent.TOOL_TYPE_FINGER;
                coordinates[index] = new MotionEvent.PointerCoords();
                coordinates[index].x = points.get(index).x;
                coordinates[index].y = points.get(index).y;
                coordinates[index].pressure = 1f;
                coordinates[index].size = 1f;
            }
            MotionEvent event = MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action,
                    ids.size(), properties, coordinates, 0, 0, 1f, 1f, 0, 0,
                    InputDevice.SOURCE_TOUCHSCREEN, 0);
            try { instrumentation.sendPointerSync(event); }
            finally { event.recycle(); }
        }

        @Override public void close() {
            while (!ids.isEmpty()) up(ids.get(ids.size() - 1));
        }
    }

    private void verifyNativeIme() throws Exception {
        performNativeBack();
        waitFor("IME room menu", "!document.getElementById('screen').hidden", 5_000);
        evaluate("(() => {document.getElementById('private-room-panel').open=true;return {ok:true};})()");
        enterNativeText("room-player-name", "O'Neil QA");
        enterNativeText("room-code-input", "AB23CD");
        hideNativeKeyboard();
        JSONObject values = evaluate("({name:document.getElementById('room-player-name').value,"
                + "code:document.getElementById('room-code-input').value})");
        assertEquals("Quoted player names must survive native IME commitText", "O'Neil QA", values.getString("name"));
        assertEquals("Join codes must be editable through the native keyboard", "AB23CD", values.getString("code"));
        writeJsonReport("islandworld-android-ime.json", values, "native_ime");
        saveScreenshot("islandworld-android-ime.png");
        performNativeBack();
        waitFor("IME test returns to play", "document.getElementById('screen').hidden"
                + " && !document.getElementById('touch-controls').hidden", 5_000);
    }

    private void enterNativeText(String elementId, String text) throws Exception {
        tapElement(elementId);
        waitFor("native editor focus", "document.activeElement?.id===" + JSONObject.quote(elementId), 5_000);
        JSONObject existing = evaluate("({text:document.getElementById(" + JSONObject.quote(elementId) + ").value})");
        int length = existing.getString("text").length();
        AtomicReference<InputConnection> input = new AtomicReference<>();
        scenario.onActivity(activity -> input.set(activity.getBridge().getWebView()
                .onCreateInputConnection(new EditorInfo())));
        assertNotNull("WebView did not provide a native InputConnection", input.get());
        CountDownLatch completed = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();
        Runnable commit = () -> {
            try {
                InputConnection connection = input.get();
                connection.beginBatchEdit();
                assertTrue("Native editor selection failed", connection.setSelection(0, length));
                assertTrue("Native IME commitText failed", connection.commitText(text, 1));
                connection.endBatchEdit();
            } catch (Throwable cause) { failure.set(cause); }
            finally { completed.countDown(); }
        };
        Handler handler = input.get().getHandler();
        if (handler == null) instrumentation.runOnMainSync(commit);
        else assertTrue("Native IME handler rejected edit", handler.post(commit));
        assertTrue("Native IME edit timed out", completed.await(10, TimeUnit.SECONDS));
        if (failure.get() != null) throw new AssertionError("Native input failed", failure.get());
        waitFor("native IME value", "document.getElementById(" + JSONObject.quote(elementId)
                + ").value===" + JSONObject.quote(text), 10_000);
    }

    private void hideNativeKeyboard() {
        scenario.onActivity(activity -> {
            InputMethodManager keyboard = (InputMethodManager) activity.getSystemService(Context.INPUT_METHOD_SERVICE);
            keyboard.hideSoftInputFromWindow(activity.getBridge().getWebView().getWindowToken(), 0);
        });
        SystemClock.sleep(300);
    }

    private void performNativeBack() {
        // This verifies the native AppPlugin dispatcher/callback integration.
        // It does not claim that physical system navigation gestures were
        // tested: edge injection is unreliable in an immersive cutout window,
        // and Android 16 targetSdk 36 no longer dispatches KEYCODE_BACK.
        scenario.onActivity(activity -> activity.getOnBackPressedDispatcher().onBackPressed());
    }

    private void lookVertically(boolean upwards) throws Exception {
        JSONObject route = safeLookRoute();
        PointF bottomPoint = nativePoint(route.getDouble("x"), route.getDouble("bottom"), route.getDouble("viewportWidth"));
        PointF topPoint = nativePoint(route.getDouble("x"), route.getDouble("top"), route.getDouble("viewportWidth"));
        float x = bottomPoint.x, bottom = bottomPoint.y, top = topPoint.y;
        for (int gesture = 0; gesture < 3; gesture++) {
            float start = upwards ? bottom : top, finish = upwards ? top : bottom;
            long downTime = SystemClock.uptimeMillis();
            injectTouchDragEvent(downTime, MotionEvent.ACTION_DOWN, x, start);
            for (int step = 1; step <= 12; step++) {
                SystemClock.sleep(18);
                injectTouchDragEvent(downTime, MotionEvent.ACTION_MOVE, x,
                        start + (finish - start) * step / 12f);
            }
            injectTouchDragEvent(downTime, MotionEvent.ACTION_UP, x, finish);
            SystemClock.sleep(40);
        }
    }

    private JSONObject safeLookRoute() throws Exception {
        JSONObject route = evaluate("(() => {const look=document.getElementById('touch-look');"
                + "const bottom=innerHeight*.76,top=bottom-Math.min(200,innerHeight*.60);"
                + "for(const fraction of [.62,.55,.68,.48,.74]){const x=innerWidth*fraction;let safe=true;"
                + "for(let i=0;i<=12;i++){if(document.elementFromPoint(x,top+(bottom-top)*i/12)!==look){safe=false;break;}}"
                + "if(safe)return {safe:true,x,top,bottom,viewportWidth:innerWidth};}"
                + "return {safe:false,width:innerWidth,height:innerHeight};})()");
        assertTrue("Look gesture must avoid every visible control: " + route, route.getBoolean("safe"));
        return route;
    }

    private PointF nativePoint(double cssX, double cssY, double viewportWidth) {
        final int[] offset = new int[2];
        final int[] viewWidth = new int[1];
        scenario.onActivity(activity -> {
            WebView view = activity.getBridge().getWebView();
            view.getLocationOnScreen(offset);
            viewWidth[0] = view.getWidth();
        });
        float scale = viewWidth[0] / (float) viewportWidth;
        return new PointF(offset[0] + (float) cssX * scale, offset[1] + (float) cssY * scale);
    }

    private void injectTouchDragEvent(long downTime, int action, float x, float y) {
        MotionEvent event = fingerMotionEvent(downTime, action, x, y);
        try { instrumentation.sendPointerSync(event); }
        finally { event.recycle(); }
    }

    private MotionEvent fingerMotionEvent(long downTime, int action, float x, float y) {
        MotionEvent.PointerProperties property = new MotionEvent.PointerProperties();
        property.id = 0; property.toolType = MotionEvent.TOOL_TYPE_FINGER;
        MotionEvent.PointerCoords coordinate = new MotionEvent.PointerCoords();
        coordinate.x = x; coordinate.y = y; coordinate.pressure = 1f; coordinate.size = 1f;
        return MotionEvent.obtain(downTime, SystemClock.uptimeMillis(), action, 1,
                new MotionEvent.PointerProperties[] {property}, new MotionEvent.PointerCoords[] {coordinate},
                0, 0, 1f, 1f, 0, 0, InputDevice.SOURCE_TOUCHSCREEN, 0);
    }

    private void measureFrameCadence() throws Exception {
        // Standard requestAnimationFrame timing observes the actual rendered
        // scene. No private game APIs or frame-rate acceptance threshold.
        evaluate("(() => {delete document.body.dataset.androidSmokeFrames;const timings=[];let previous;"
                + "const measure=now=>{if(previous!==undefined)timings.push(now-previous);previous=now;"
                + "if(timings.length<60){requestAnimationFrame(measure);return;}"
                + "const sorted=[...timings].sort((a,b)=>a-b);"
                + "const total=timings.reduce((a,b)=>a+b,0);"
                + "document.body.dataset.androidSmokeFrames=JSON.stringify({samples:60,"
                + "averageFps:60000/total,medianFps:1000/((sorted[29]+sorted[30])/2),"
                + "worstFrameMs:sorted[59],viewport:[innerWidth,innerHeight],"
                + "canvas:[document.querySelector('#game canvas').width,document.querySelector('#game canvas').height]});};"
                + "requestAnimationFrame(measure);return {started:true};})()");
        waitFor("60-frame cadence report", "!!document.body.dataset.androidSmokeFrames", 50_000);
        JSONObject report = evaluate("JSON.parse(document.body.dataset.androidSmokeFrames)");
        writeJsonReport("islandworld-android-frame-stats.json", report, "frame_stats");
        evaluate("(() => {delete document.body.dataset.androidSmokeFrames;return {removed:true};})()");
    }

    private void writeJsonReport(String filename, JSONObject report, String key) throws Exception {
        File directory = new File(instrumentation.getTargetContext().getExternalFilesDir(null), "instrumentation");
        assertTrue(directory.exists() || directory.mkdirs());
        File output = new File(directory, filename);
        try (FileOutputStream stream = new FileOutputStream(output)) {
            stream.write(report.toString(2).getBytes(StandardCharsets.UTF_8));
        }
        Bundle status = new Bundle();
        status.putString(key, report.toString());
        status.putString(key + "_file", output.getAbsolutePath());
        instrumentation.sendStatus(0, status);
    }

    private void saveScreenshot(String name) throws Exception {
        // DOM acknowledgments can precede the WebView compositor presenting
        // those updates. Synchronize the actual visual state and a subsequent
        // draw before capturing, rather than saving a stale pre-join frame.
        CountDownLatch painted = new CountDownLatch(1);
        scenario.onActivity(activity -> {
            WebView view = activity.getBridge().getWebView();
            view.postVisualStateCallback(SystemClock.uptimeMillis(), new WebView.VisualStateCallback() {
                @Override public void onComplete(long requestId) {
                    view.postInvalidateOnAnimation();
                    view.postOnAnimation(() -> view.postOnAnimation(painted::countDown));
                }
            });
        });
        assertTrue("WebView screenshot visual state did not finish drawing", painted.await(25, TimeUnit.SECONDS));
        Bitmap bitmap = instrumentation.getUiAutomation().takeScreenshot();
        assertNotNull("Android screenshot capture failed", bitmap);
        File directory = new File(instrumentation.getTargetContext().getExternalFilesDir(null), "instrumentation");
        assertTrue(directory.exists() || directory.mkdirs());
        File output = new File(directory, name);
        try (FileOutputStream stream = new FileOutputStream(output)) {
            assertTrue(bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream));
        } finally { bitmap.recycle(); }
        Bundle report = new Bundle();
        report.putString("screenshot", output.getAbsolutePath());
        instrumentation.sendStatus(0, report);
    }
}
