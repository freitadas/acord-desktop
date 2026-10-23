$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms

$source = @"
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public static class AcordInput {
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    const uint MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint KEYEVENTF_KEYUP = 0x0002;

    public static void Move(double x, double y) {
        var b = Screen.PrimaryScreen.Bounds;
        int px = b.Left + (int)Math.Round(Math.Max(0, Math.Min(1, x)) * Math.Max(1, b.Width - 1));
        int py = b.Top + (int)Math.Round(Math.Max(0, Math.Min(1, y)) * Math.Max(1, b.Height - 1));
        SetCursorPos(px, py);
    }

    public static void Button(int button, bool down) {
        uint flag;
        if (button == 2) flag = down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP;
        else if (button == 1) flag = down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP;
        else flag = down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP;
        mouse_event(flag, 0, 0, 0, UIntPtr.Zero);
    }

    public static void Wheel(int delta) {
        unchecked {
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, (uint)delta, UIntPtr.Zero);
        }
    }

    public static void Key(int vk, bool down) {
        if (vk <= 0 || vk > 255) return;
        keybd_event((byte)vk, 0, down ? 0u : KEYEVENTF_KEYUP, UIntPtr.Zero);
    }
}
"@

Add-Type -TypeDefinition $source -ReferencedAssemblies System.Windows.Forms

$downKeys = @{}
$downButtons = @{}

function Get-VirtualKey([string]$code) {
    if ($code -match '^Key([A-Z])$') { return [int][char]$Matches[1] }
    if ($code -match '^Digit([0-9])$') { return [int][char]$Matches[1] }
    if ($code -match '^F([1-9]|1[0-2])$') { return 111 + [int]$Matches[1] }
    switch ($code) {
        'Space' { return 32 }
        'Enter' { return 13 }
        'Escape' { return 27 }
        'Backspace' { return 8 }
        'Tab' { return 9 }
        'ArrowLeft' { return 37 }
        'ArrowUp' { return 38 }
        'ArrowRight' { return 39 }
        'ArrowDown' { return 40 }
        'Home' { return 36 }
        'End' { return 35 }
        'PageUp' { return 33 }
        'PageDown' { return 34 }
        'Insert' { return 45 }
        'Delete' { return 46 }
        'ShiftLeft' { return 16 }
        'ShiftRight' { return 16 }
        'ControlLeft' { return 17 }
        'ControlRight' { return 17 }
        'AltLeft' { return 18 }
        'AltRight' { return 18 }
        'Minus' { return 189 }
        'Equal' { return 187 }
        'BracketLeft' { return 219 }
        'BracketRight' { return 221 }
        'Backslash' { return 220 }
        'Semicolon' { return 186 }
        'Quote' { return 222 }
        'Comma' { return 188 }
        'Period' { return 190 }
        'Slash' { return 191 }
        'Backquote' { return 192 }
        default { return 0 }
    }
}

function Release-All {
    foreach ($vk in @($downKeys.Keys)) {
        [AcordInput]::Key([int]$vk, $false)
    }
    foreach ($button in @($downButtons.Keys)) {
        [AcordInput]::Button([int]$button, $false)
    }
    $downKeys.Clear()
    $downButtons.Clear()
}

try {
    while (($line = [Console]::In.ReadLine()) -ne $null) {
        if ([string]::IsNullOrWhiteSpace($line) -or $line.Length -gt 4096) { continue }
        try { $evt = $line | ConvertFrom-Json } catch { continue }
        if ($null -eq $evt -or [string]::IsNullOrWhiteSpace([string]$evt.type)) { continue }

        switch ([string]$evt.type) {
            'pointer-move' {
                [AcordInput]::Move([double]$evt.x, [double]$evt.y)
            }
            'pointer-button' {
                $button = [Math]::Max(0, [Math]::Min(2, [int]$evt.button))
                $down = [bool]$evt.down
                [AcordInput]::Button($button, $down)
                if ($down) { $downButtons[$button] = $true } else { $downButtons.Remove($button) }
            }
            'wheel' {
                $delta = [Math]::Max(-1200, [Math]::Min(1200, [int]$evt.deltaY))
                if ($delta -ne 0) { [AcordInput]::Wheel(-$delta) }
            }
            'key' {
                $code = [string]$evt.code
                if ($code -like 'Meta*') { continue }
                $vk = Get-VirtualKey $code
                if ($vk -le 0) { continue }
                $down = [bool]$evt.down
                [AcordInput]::Key($vk, $down)
                if ($down) { $downKeys[$vk] = $true } else { $downKeys.Remove($vk) }
            }
            'release-all' {
                Release-All
            }
        }
    }
} finally {
    Release-All
}
