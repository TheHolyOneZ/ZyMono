using System;
using System.Linq;
using System.Reflection;
using BepInEx;
using BepInEx.Logging;
using BepInEx.Unity.IL2CPP;
using Il2CppInterop.Runtime.Injection;
using UnityEngine;

namespace ZyMono.Receiver
{

    [BepInPlugin(Guid, Name, Version)]
    public class Plugin : BasePlugin
    {
        public const string Guid = "eu.zlogic.zymono.receiver.il2cpp";
        public const string Name = "ZyMono Receiver (IL2CPP)";
        public const string Version = "0.3.0";

        internal new static ManualLogSource Log;
        private PipeServer _server;

        public override void Load()
        {
            try
            {
                Log = base.Log;
                Log.LogInfo(Name + " " + Version + " starting.");

                ClassInjector.RegisterTypeInIl2Cpp<Dispatcher>();
                var host = new GameObject("ZyMonoReceiverDispatcher");
                UnityEngine.Object.DontDestroyOnLoad(host);
                host.hideFlags = HideFlags.HideAndDontSave;
                var dispatcher = host.AddComponent<Dispatcher>();

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

        private static string LoadBepInPluginAuto(Assembly assembly, byte[] _bytes)
        {
            var baseType = typeof(BasePlugin);
            var pluginTypes = assembly.GetTypes()
                .Where(t => baseType.IsAssignableFrom(t) && !t.IsAbstract && t.GetCustomAttribute<BepInPlugin>() != null)
                .ToArray();
            if (pluginTypes.Length == 0)
                throw new Exception("no [BepInPlugin] BasePlugin class found in this assembly");

            var chainloaderType = Type.GetType("BepInEx.Unity.IL2CPP.IL2CPPChainloader, BepInEx.Unity.IL2CPP");
            object chainloaderInstance = null;
            MethodInfo loadPluginMi = null;
            if (chainloaderType != null)
            {
                var instanceProp = chainloaderType.GetProperty("Instance", BindingFlags.Public | BindingFlags.Static);
                chainloaderInstance = instanceProp?.GetValue(null);
                loadPluginMi = chainloaderType.GetMethods(BindingFlags.Public | BindingFlags.Instance)
                    .FirstOrDefault(m => m.Name == "LoadPlugin" && m.GetParameters().Length == 1 &&
                                          m.GetParameters()[0].ParameterType == typeof(Type));
            }

            var loaded = new System.Collections.Generic.List<string>();
            foreach (var t in pluginTypes)
            {
                var attr = t.GetCustomAttribute<BepInPlugin>();
                try
                {
                    if (loadPluginMi != null && chainloaderInstance != null)
                    {
                        loadPluginMi.Invoke(chainloaderInstance, new object[] { t });
                    }
                    else
                    {

                        var instance = Activator.CreateInstance(t);
                        var loadMi = t.GetMethod("Load", BindingFlags.Public | BindingFlags.Instance);
                        loadMi?.Invoke(instance, null);
                    }
                    loaded.Add(attr?.Name ?? t.FullName);
                }
                catch (TargetInvocationException tie)
                {
                    throw tie.InnerException ?? tie;
                }
            }
            return $"BepInPlugin (IL2CPP) registered: {string.Join(", ", loaded)}";
        }
    }
}
