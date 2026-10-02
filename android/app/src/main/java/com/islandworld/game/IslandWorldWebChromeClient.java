package com.islandworld.game;

import android.webkit.PermissionRequest;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebChromeClient;

/** Voice access remains opt-in through getUserMedia and Android's permission prompt. */
public final class IslandWorldWebChromeClient extends BridgeWebChromeClient {
    public IslandWorldWebChromeClient(Bridge bridge) {
        super(bridge);
    }

    static boolean permitsAudio(String origin, String[] resources) {
        return ("https://localhost/".equals(origin) || "https://localhost".equals(origin))
            && resources != null
            && resources.length == 1
            && PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resources[0]);
    }

    @Override
    public void onPermissionRequest(PermissionRequest request) {
        if (!permitsAudio(request.getOrigin().toString(), request.getResources())) {
            request.deny();
            return;
        }
        // Capacitor requests RECORD_AUDIO at runtime and grants only after consent.
        super.onPermissionRequest(request);
    }
}
