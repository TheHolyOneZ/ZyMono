using BepInEx;
using BepInEx.Logging;
using UnityEngine;

namespace ZyMono.Receiver
{
    // The in-game half of ZyMono's pipe-injection route. When BepInEx is
    // actually running, this plugin loads with the game and answers ZyMono over
    // a named pipe: a PING health-check and a LOAD request that loads a managed
    // assembly and invokes one entry point ON THE UNITY MAIN THREAD (safe with
    // Harmony/Photon), then reports back whether it worked.
    [BepInPlugin(Guid, Name, Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "eu.zlogic.zymono.receiver";
        public const string Name = "ZyMono Receiver";
        public const string Version = "0.1.0";

        internal static ManualLogSource Log;
        private PipeServer _server;

        private void Awake()
        {
            Log = Logger;
            Log.LogInfo($"{Name} {Version} starting.");

            // A persistent object that pumps queued work on the main thread.
            var host = new GameObject("ZyMonoReceiverDispatcher");
            DontDestroyOnLoad(host);
            host.hideFlags = HideFlags.HideAndDontSave;
            var dispatcher = host.AddComponent<Dispatcher>();

            _server = new PipeServer(dispatcher);
            _server.Start();

            Log.LogInfo("Receiver pipe server listening on \\\\.\\pipe\\zymono-receiver");
        }

        private void OnDestroy()
        {
            _server?.Stop();
        }
    }
}
