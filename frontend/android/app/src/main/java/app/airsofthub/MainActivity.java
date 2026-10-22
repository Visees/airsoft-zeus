package app.airsofthub;

import android.os.Bundle;
import androidx.activity.EdgeToEdge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Draw under the status bar, navigation bar and camera cutout on every Android version, not only
        // 15+ (where it is forced). Without it Android 14 and older leave grey bands there, e.g. beside the
        // camera with the map in landscape; the page keeps its UI clear with env(safe-area-inset-*).
        EdgeToEdge.enable(this);
    }
}
