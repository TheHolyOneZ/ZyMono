using System;
using System.Linq;
using System.Reflection;
using BepInEx;
using BepInEx.Bootstrap;
using BepInEx.Logging;
using UnityEngine;

namespace ZyMono.Receiver
{

    [BepInPlugin(Guid, Name, Version)]
    public class Plugin : BaseUnityPlugin
    {
        public const string Guid = "eu.zlogic.zymono.receiver";
        public const string Name = "ZyMono Receiver";
        public const string Version = "0.3.0";

        internal static ManualLogSource Log;
        private PipeServer _server;
        private static GameObject _pluginHost;

        private void Awake()
        {
            try
            {
                Log = Logger;
                Log.LogInfo($"{Name} {Version} starting.");

                var host = new GameObject("ZyMonoReceiverDispatcher");
                DontDestroyOnLoad(host);
                host.hideFlags = HideFlags.HideAndDontSave;
                var dispatcher = host.AddComponent<Dispatcher>();

                _pluginHost = new GameObject("ZyMonoReceiverPluginHost");
                DontDestroyOnLoad(_pluginHost);

                Loader.AutoRegister = LoadBepInPluginAuto;

                _server = new PipeServer(dispatcher);
                _server.Start();

                Log.LogInfo("Receiver pipe server listening on \\\\.\\pipe\\zymono-receiver");
            }
            catch (Exception e)
            {
                try { Log?.LogError("[ZyMono] receiver init failed: " + e); } catch { }
            }
        }

        private void OnDestroy()
        {
            _server?.Stop();
        }

        private static string LoadBepInPluginAuto(Assembly assembly, byte[] _bytes)
        {
            var baseType = typeof(BaseUnityPlugin);
            var pluginTypes = assembly.GetTypes()
                .Where(t => baseType.IsAssignableFrom(t) && !t.IsAbstract && t.GetCustomAttribute<BepInPlugin>() != null)
                .ToArray();
            if (pluginTypes.Length == 0)
                throw new Exception("no [BepInPlugin] BaseUnityPlugin class found in this assembly");

            var loaded = new System.Collections.Generic.List<string>();
            foreach (var t in pluginTypes)
            {
                var attr = t.GetCustomAttribute<BepInPlugin>();
                if (attr != null && Chainloader.PluginInfos.ContainsKey(attr.GUID))
                {
                    loaded.Add(attr.Name + " (already loaded)");
                    continue;
                }
                _pluginHost.AddComponent(t);
                loaded.Add(attr?.Name ?? t.FullName);
            }
            return $"BepInPlugin registered: {string.Join(", ", loaded)}";
        }
    }
}
