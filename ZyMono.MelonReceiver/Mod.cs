using System;
using System.Collections;
using System.IO;
using System.Linq;
using System.Reflection;
using MelonLoader;
using ZyMono.Receiver;

[assembly: MelonInfo(typeof(ZyMono.MelonReceiver.Mod), "ZyMono Melon Receiver", "0.3.0", "TheHolyOneZ")]
[assembly: MelonGame(null, null)]

namespace ZyMono.MelonReceiver
{
    public class Mod : MelonMod
    {
        private PipeServer _server;
        private Dispatcher _dispatcher;

        public override void OnInitializeMelon()
        {

            try
            {
                ZyMono.Receiver.Plugin.Log = new ZyMono.Receiver.Plugin.MelonLogShim();
                ZyMono.Receiver.Plugin.Log.LogInfo("ZyMono Melon Receiver 0.3.0 starting.");

                _dispatcher = new Dispatcher();
                _server = new PipeServer(_dispatcher);
                _server.Start();

                Loader.AutoRegister = LoadMelonAssemblyAuto;

                ZyMono.Receiver.Plugin.Log.LogInfo("Receiver pipe server listening on \\\\.\\pipe\\zymono-receiver");
            }
            catch (Exception e)
            {
                try { MelonLoader.MelonLogger.Error("[ZyMono] receiver init failed: " + e); } catch { }
            }
        }

        private static string LoadMelonAssemblyAuto(Assembly assembly, byte[] bytes)
        {
            var melonAssemblyType = Type.GetType("MelonLoader.MelonAssembly, MelonLoader")
                ?? Type.GetType("MelonLoader.MelonAssembly, MelonLoader.ModHandler");
            if (melonAssemblyType == null)
                throw new Exception("MelonLoader.MelonAssembly type not found — MelonLoader might not be initialised yet");

            var methods = melonAssemblyType.GetMethods(BindingFlags.Public | BindingFlags.Static);
            string usedSig = null;
            object result = null;

            foreach (var m in methods)
            {
                if (m.Name != "LoadMelonAssembly") continue;
                var ps = m.GetParameters();
                if (ps.Length >= 1 && ps[0].ParameterType == typeof(Assembly))
                {
                    result = InvokeWithDefaults(m, assembly);
                    usedSig = "LoadMelonAssembly(Assembly)";
                    break;
                }
            }

            if (result == null)
            {
                foreach (var m in methods)
                {
                    if (m.Name != "LoadRawMelonAssembly") continue;
                    var ps = m.GetParameters();
                    if (ps.Length >= 1 && ps[0].ParameterType == typeof(byte[]))
                    {
                        result = InvokeWithDefaults(m, bytes);
                        usedSig = "LoadRawMelonAssembly(byte[])";
                        break;
                    }
                }
            }

            if (result == null)
            {
                foreach (var m in methods)
                {
                    if (m.Name != "LoadMelonAssembly") continue;
                    var ps = m.GetParameters();
                    if (ps.Length >= 1 && ps[0].ParameterType == typeof(string))
                    {
                        var tmp = Path.Combine(Path.GetTempPath(),
                            "zymono_" + Guid.NewGuid().ToString("N") + ".dll");
                        File.WriteAllBytes(tmp, bytes);
                        result = InvokeWithDefaults(m, tmp);
                        usedSig = "LoadMelonAssembly(string)";
                        break;
                    }
                }
            }

            if (result == null)
            {
                var handlerType = Type.GetType("MelonLoader.MelonHandler, MelonLoader");
                if (handlerType != null)
                {
                    foreach (var m in handlerType.GetMethods(BindingFlags.Public | BindingFlags.Static))
                    {
                        if (m.Name != "LoadFromByteArray") continue;
                        var ps = m.GetParameters();
                        if (ps.Length >= 1 && ps[0].ParameterType == typeof(byte[]))
                        {
                            result = InvokeWithDefaults(m, bytes);
                            usedSig = "MelonHandler.LoadFromByteArray(byte[])";
                            break;
                        }
                    }
                }
            }

            if (usedSig == null)
            {
                var seen = string.Join(", ",
                    methods.Where(m => m.Name.IndexOf("Load", StringComparison.OrdinalIgnoreCase) >= 0)
                        .Select(m => m.Name + "(" + string.Join(",",
                            m.GetParameters().Select(p => p.ParameterType.Name)) + ")"));
                throw new Exception("No compatible MelonLoader load API found. MelonAssembly exposes: [" + seen + "]");
            }

            if (result == null)
                throw new Exception($"{usedSig} returned null — the assembly may not contain any [MelonInfo]-marked MelonMod class");

            var resultType = result.GetType();
            var loadedProp = resultType.GetProperty("LoadedMelons")
                ?? resultType.GetProperty("Melons");
            var loaded = loadedProp?.GetValue(result) as IEnumerable;
            int count = 0;
            var lines = new System.Collections.Generic.List<string>();
            if (loaded != null)
            {
                foreach (var melon in loaded)
                {
                    if (melon == null) continue;
                    count++;
                    var mt = melon.GetType();

                    var registeredProp = mt.GetProperty("Registered");
                    bool wasRegistered = registeredProp?.GetValue(melon) as bool? ?? false;

                    string melonName = mt.FullName;
                    try
                    {
                        var infoProp = mt.GetProperty("Info");
                        var info = infoProp?.GetValue(melon);
                        var nameProp = info?.GetType().GetProperty("Name");
                        melonName = nameProp?.GetValue(info) as string ?? melonName;
                    }
                    catch { }

                    if (!wasRegistered)
                    {
                        var regMi = mt.GetMethod("Register",
                            BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                            null, Type.EmptyTypes, null);
                        if (regMi != null)
                        {
                            try { regMi.Invoke(melon, null); }
                            catch (TargetInvocationException tie)
                            {
                                MelonLogger.Warning("[ZyMono] Register() on " + melonName + " threw: " + (tie.InnerException ?? tie).Message);
                            }
                        }
                    }

                    TryInvokeLifecycle(melon, mt, "OnInitializeMelon");
                    TryInvokeLifecycle(melon, mt, "OnLateInitializeMelon");

                    TryInvokeLifecycle(melon, mt, "OnApplicationStart");
                    TryInvokeLifecycle(melon, mt, "OnApplicationLateStart");

                    bool nowRegistered = registeredProp?.GetValue(melon) as bool? ?? false;
                    lines.Add(melonName + (nowRegistered ? " (registered)" : wasRegistered ? " (already registered)" : " (init'd but not registered — MelonLoader may still fire OnUpdate)"));
                }
            }

            var asmName = assembly.GetName().Name;
            return $"[{usedSig}] {asmName} → {count} Melon(s): " + string.Join("; ", lines);
        }

        private static void TryInvokeLifecycle(object melon, Type mt, string methodName)
        {
            var mi = mt.GetMethod(methodName,
                BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Instance,
                null, Type.EmptyTypes, null);
            if (mi == null) return;
            try
            {
                mi.Invoke(melon, null);
            }
            catch (TargetInvocationException tie)
            {
                var inner = tie.InnerException ?? tie;
                MelonLogger.Warning("[ZyMono] " + methodName + " on " + mt.FullName + " threw: " + inner.Message);
            }
            catch (Exception ex)
            {
                MelonLogger.Warning("[ZyMono] " + methodName + " on " + mt.FullName + " threw: " + ex.Message);
            }
        }

        private static object InvokeWithDefaults(MethodInfo m, object firstArg)
        {
            var ps = m.GetParameters();
            object[] args;
            if (ps.Length == 1) args = new object[] { firstArg };
            else
            {
                args = new object[ps.Length];
                args[0] = firstArg;
                for (int i = 1; i < ps.Length; i++)
                {
                    args[i] = ps[i].HasDefaultValue ? ps[i].DefaultValue
                        : ps[i].ParameterType.IsValueType ? Activator.CreateInstance(ps[i].ParameterType)
                        : null;
                }
            }
            try { return m.Invoke(null, args); }
            catch (TargetInvocationException tie) { throw tie.InnerException ?? tie; }
        }

        public override void OnUpdate()
        {
            _dispatcher?.Pump();
        }

        public override void OnDeinitializeMelon()
        {
            _server?.Stop();
        }
    }
}
