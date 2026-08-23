using System;
using System.IO;
using System.Reflection;

namespace ZyMono.Receiver
{
    // Loads a managed assembly and invokes one entry point. Runs on the Unity
    // main thread (via Dispatcher), so Harmony patching / Unity API calls made
    // by the entry point are safe.
    internal static class Loader
    {
        public static string Load(string path, string typeName, string method, string[] args)
        {
            if (!File.Exists(path))
                throw new FileNotFoundException("assembly not found", path);

            // Load from bytes so the file isn't locked on disk.
            byte[] bytes = File.ReadAllBytes(path);
            Assembly asm = Assembly.Load(bytes);

            Type type = asm.GetType(typeName, throwOnError: false);
            if (type == null)
                throw new Exception("type not found: " + typeName);

            const BindingFlags flags = BindingFlags.Public | BindingFlags.NonPublic
                | BindingFlags.Static | BindingFlags.Instance;
            MethodInfo mi = type.GetMethod(method, flags);
            if (mi == null)
                throw new Exception("method not found: " + method);

            object target = mi.IsStatic ? null : Activator.CreateInstance(type);
            object[] callArgs = BuildArgs(mi, args);
            object ret = mi.Invoke(target, callArgs);
            return ret == null ? "" : ret.ToString();
        }

        private static object[] BuildArgs(MethodInfo mi, string[] args)
        {
            ParameterInfo[] ps = mi.GetParameters();
            if (ps.Length == 0) return null;

            var result = new object[ps.Length];
            for (int i = 0; i < ps.Length; i++)
            {
                string val = (args != null && i < args.Length) ? args[i] : null;
                Type pt = ps[i].ParameterType;
                if (pt == typeof(string) || val == null)
                    result[i] = val;
                else
                    result[i] = Convert.ChangeType(val, pt);
            }
            return result;
        }
    }
}
