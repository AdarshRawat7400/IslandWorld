package com.islandworld.game;

import android.os.Bundle;
import android.view.WindowManager;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (bridge != null) {
            // Inherit Capacitor's dialogs and runtime permission handling. Restrict
            // voice capture to this app's bundled, secure origin and audio only.
            bridge.getWebView().setWebChromeClient(new IslandWorldWebChromeClient(bridge));
            ViewCompat.setOnApplyWindowInsetsListener(bridge.getWebView(), (view, insets) -> {
                androidx.core.graphics.Insets cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout());
                view.setPadding(cutout.left, cutout.top, cutout.right, cutout.bottom);
                return insets;
            });
        }
        enterImmersiveMode();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) enterImmersiveMode();
    }

    private void enterImmersiveMode() {
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsetsCompat.Type.systemBars());
    }
}
