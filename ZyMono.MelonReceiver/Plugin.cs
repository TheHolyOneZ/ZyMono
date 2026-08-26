using System;

namespace ZyMono.Receiver
{
    public static class Plugin
    {
        public const string Version = "0.3.0";

        internal static ILog Log;

        public interface ILog
        {
            void LogInfo(string s);
            void LogWarning(string s);
            void LogError(string s);
        }

        public class MelonLogShim : ILog
        {
            public void LogInfo(string s) { MelonLoader.MelonLogger.Msg(s); }
            public void LogWarning(string s) { MelonLoader.MelonLogger.Warning(s); }
            public void LogError(string s) { MelonLoader.MelonLogger.Error(s); }
        }
    }
}
