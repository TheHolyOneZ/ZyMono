using System;
using System.Collections.Concurrent;
using System.Threading;
using UnityEngine;

namespace ZyMono.Receiver
{
    // Runs queued work on the Unity main thread. The pipe server (a background
    // thread) hands assembly-load work here so it executes where Unity/Harmony
    // expect it, then blocks for the result.
    public class Dispatcher : MonoBehaviour
    {
        private readonly ConcurrentQueue<Action> _queue = new ConcurrentQueue<Action>();

        private void Update()
        {
            while (_queue.TryDequeue(out var action))
            {
                try { action(); }
                catch (Exception e) { Plugin.Log?.LogError("Dispatcher action failed: " + e); }
            }
        }

        // Run `func` on the main thread and block the caller until it returns.
        public T RunBlocking<T>(Func<T> func, int timeoutMs)
        {
            T result = default;
            Exception error = null;
            using (var done = new ManualResetEventSlim(false))
            {
                _queue.Enqueue(() =>
                {
                    try { result = func(); }
                    catch (Exception e) { error = e; }
                    finally { done.Set(); }
                });

                if (!done.Wait(timeoutMs))
                    throw new TimeoutException("main-thread work did not complete in time");
            }
            if (error != null) throw error;
            return result;
        }
    }
}
