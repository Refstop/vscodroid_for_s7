// Debug-only shell helper; never packaged in the application. Compile against
// android.jar with javac -source 8 -target 8, then run d8 on HardwareKeys.class.
// Push classes.dex to /data/local/tmp/vscodroid-hardware-keys.dex and invoke:
// CLASSPATH=<dex> app_process / HardwareKeys <device-id> <keycodes...>
// Unlike `adb shell input`, the events identify the physical keyboard, allowing
// Samsung's actual input method to compose Korean rather than bypassing it.
import android.hardware.input.InputManager;
import android.os.SystemClock;
import android.view.InputDevice;
import android.view.KeyEvent;
public class HardwareKeys {
 public static void main(String[] args) throws Exception {
  Object manager=InputManager.class.getMethod("getInstance").invoke(null);
  java.lang.reflect.Method inject=InputManager.class.getMethod("injectInputEvent",android.view.InputEvent.class,int.class);
  int device=Integer.parseInt(args[0]);
  for(int i=1;i<args.length;i++) {
   int code=Integer.parseInt(args[i]); long now=SystemClock.uptimeMillis();
   for(int action:new int[]{KeyEvent.ACTION_DOWN,KeyEvent.ACTION_UP}) {
    KeyEvent event=new KeyEvent(now,SystemClock.uptimeMillis(),action,code,0,0,device,code==204?122:0,KeyEvent.FLAG_FROM_SYSTEM,InputDevice.SOURCE_KEYBOARD);
    if(!((Boolean)inject.invoke(manager,event,2)))throw new Exception("Injection failed");
   }
   SystemClock.sleep(60);
  }
 }
}
