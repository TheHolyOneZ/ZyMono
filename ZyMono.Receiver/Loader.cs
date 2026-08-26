using System;
using System.IO;
using System.Reflection;

namespace ZyMono.Receiver
{

    internal static class Loader
    {

        public static Func<Assembly, byte[], string> AutoRegister;

        public static string Load(string path, string typeName, string method, string[] args)
        {
            if (!File.Exists(path))
                throw new FileNotFoundException("assembly not found", path);

            byte[] bytes = File.ReadAllBytes(path);
            Assembly asm = Assembly.Load(bytes);

            if (string.IsNullOrEmpty(typeName) && string.IsNullOrEmpty(method))
            {
                if (AutoRegister == null)
                    throw new Exception("no entry point given and this receiver variant doesn't support auto-registration");
                return AutoRegister(asm, bytes);
            }

            return InvokeIn(asm, typeName, method, args);
        }

        public static string Invoke(string assemblyName, string typeName, string method, string[] args)
        {
            if (string.IsNullOrEmpty(assemblyName))
                throw new Exception("no assembly name");

            Assembly asm = null;
            Assembly[] loaded = AppDomain.CurrentDomain.GetAssemblies();

            for (int i = loaded.Length - 1; i >= 0; i--)
            {
                if (string.Equals(loaded[i].GetName().Name, assemblyName, StringComparison.OrdinalIgnoreCase))
                {
                    asm = loaded[i];
                    break;
                }
            }
            if (asm == null)
                throw new Exception("assembly not loaded in this game: " + assemblyName);

            return InvokeIn(asm, typeName, method, args);
        }

        private static string InvokeIn(Assembly asm, string typeName, string method, string[] args)
        {
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
