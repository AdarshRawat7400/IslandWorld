package com.islandworld.game;

import org.junit.Test;
import static org.junit.Assert.*;

public class IslandWorldWebChromeClientTest {
    private static final String AUDIO = "android.webkit.resource.AUDIO_CAPTURE";
    private static final String VIDEO = "android.webkit.resource.VIDEO_CAPTURE";

    @Test public void bundledOriginCanAskForAudio() {
        assertTrue(IslandWorldWebChromeClient.permitsAudio("https://localhost", new String[] { AUDIO }));
        assertTrue(IslandWorldWebChromeClient.permitsAudio("https://localhost/", new String[] { AUDIO }));
    }

    @Test public void otherOriginsCannotAskForMicrophone() {
        for (String origin : new String[] { "http://localhost/", "https://localhost.evil/", "https://example.com/", "file:///", null }) {
            assertFalse(IslandWorldWebChromeClient.permitsAudio(origin, new String[] { AUDIO }));
        }
    }

    @Test public void cameraAndUnknownPermissionsAreDenied() {
        assertFalse(IslandWorldWebChromeClient.permitsAudio("https://localhost/", new String[] { VIDEO }));
        assertFalse(IslandWorldWebChromeClient.permitsAudio("https://localhost/", new String[] { AUDIO, VIDEO }));
        assertFalse(IslandWorldWebChromeClient.permitsAudio("https://localhost/", new String[] { "android.webkit.resource.PROTECTED_MEDIA_ID" }));
        assertFalse(IslandWorldWebChromeClient.permitsAudio("https://localhost/", new String[] {}));
        assertFalse(IslandWorldWebChromeClient.permitsAudio("https://localhost/", null));
    }
}
