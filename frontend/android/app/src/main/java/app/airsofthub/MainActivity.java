package app.airsofthub;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Draw under the status bar, navigation bar and camera cutout on every Android version, not only
        // 15+ (where it is forced). Without it Android 14 and older leave grey bands there, e.g. beside the
        // camera with the map in landscape; the page keeps its UI clear with env(safe-area-inset-*).
        EdgeToEdge.enable(this);
        // The system back button or gesture goes back in the app's history, like a browser's back button.
        // Without this (there is no @capacitor/app listener) Android closes the app on every back. On the
        // first page it sends the app to the background instead of closing it, so live tracking keeps going.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView webView = getBridge() != null ? getBridge().getWebView() : null;
                if (webView != null && webView.canGoBack()) webView.goBack();
                else moveTaskToBack(true);
            }
        });
    }
}
