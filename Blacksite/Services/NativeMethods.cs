using System.Runtime.InteropServices;
using System.Windows;

namespace Blacksite.Services;

/// <summary>Win32 interop for drawing attention without stealing focus (task 6.1, Fix C).</summary>
internal static class NativeMethods
{
    [StructLayout(LayoutKind.Sequential)]
    private struct FLASHWINFO
    {
        public uint cbSize;
        public IntPtr hwnd;
        public uint dwFlags;
        public uint uCount;
        public uint dwTimeout;
    }

    private const uint FLASHW_ALL = 0x3; // flash the caption + taskbar button

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool FlashWindowEx(ref FLASHWINFO pwfi);

    /// <summary>
    /// Flashes the window's taskbar button + title a few times. A no-op when the app already
    /// owns the foreground (Windows only flashes background windows), so it is safe to call
    /// unconditionally when a dialog needs attention.
    /// </summary>
    public static void FlashTaskbar(Window? window)
    {
        try
        {
            if (window is null) return;
            var info = new FLASHWINFO
            {
                cbSize = (uint)Marshal.SizeOf<FLASHWINFO>(),
                hwnd = new System.Windows.Interop.WindowInteropHelper(window).Handle,
                dwFlags = FLASHW_ALL,
                uCount = 4,
                dwTimeout = 0
            };
            if (info.hwnd != IntPtr.Zero)
                FlashWindowEx(ref info);
        }
        catch
        {
            // Attention-drawing must never break a flow.
        }
    }
}
