// FightcordSetup - installs / updates / uninstalls Fightcord into Fightcade.
//
// Fightcade (a nativefier build) runs resources\app\inject\inject.js at startup.
// Fightcord puts its own loader there and its plugins in inject\fightcord\.
// Whatever was there before (the Cerberus "FC2 Injector" loader, inject\plugins\,
// inject\config.json) is copied to resources\app\fightcord-backup\<time>\ first,
// then removed; Uninstall can put it back.
//
// Built with the C# 5 compiler that ships with .NET Framework 4 (see build.ps1), so
// it runs on any Windows 10/11 without installing anything. ASCII-only source on
// purpose: csc reads BOM-less files in the ANSI code page.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Fightcord Setup")]
[assembly: AssemblyProduct("Fightcord")]
[assembly: AssemblyVersion("2.9.0.0")]
[assembly: AssemblyFileVersion("2.9.0.0")]

namespace Fightcord
{
    static class Program
    {
        // No arguments: the setup window. For scripts and testing:
        //   FightcordSetup.exe --root=<Fightcade folder> --install | --uninstall [--restore] [--log=<file>]
        [STAThread]
        static int Main(string[] args)
        {
            string rootArg = null, mode = null, logFile = null;
            bool restore = false;
            foreach (string a in args)
            {
                if (a.StartsWith("--root=")) rootArg = a.Substring(7).Trim('"');
                else if (a == "--install") mode = "install";
                else if (a == "--uninstall") mode = "uninstall";
                else if (a == "--restore") restore = true;
                else if (a.StartsWith("--log=")) logFile = a.Substring(6).Trim('"');
                else if (a.StartsWith("--lang=")) L.Lang = L.Pick(a.Substring(7));
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            SetupForm form = new SetupForm(rootArg, mode != null);
            if (mode == null) { Application.Run(form); return 0; }
            return form.Headless(mode, restore, logFile);
        }
    }

    // The window and log in the Windows language: Portuguese or Spanish (anything else stays English).
    // The tables are generated from installer\i18n.json by installer\make_i18n.js (this file stays ASCII).
    static partial class L
    {
        public static string Lang = Pick(CultureInfo.CurrentUICulture.TwoLetterISOLanguageName);
        public static string Pick(string two)
        {
            two = (two ?? "").Trim().ToLowerInvariant();
            return two.StartsWith("pt") ? "pt" : two.StartsWith("es") ? "es" : "en";
        }
        public static string T(string s)
        {
            Dictionary<string, string> d = Lang == "pt" ? Pt : Lang == "es" ? Es : null;
            string r;
            return d != null && d.TryGetValue(s, out r) ? r : s;
        }
        public static string F(string s, params object[] args) { return string.Format(T(s), args); }
    }

    // Colours from the FightCord logo: deep navy, Discord blurple, neon cyan, a touch of violet
    static class Theme
    {
        public static readonly Color Bg = Color.FromArgb(0x0d, 0x0f, 0x1f);
        public static readonly Color Hero1 = Color.FromArgb(0x18, 0x1d, 0x48);
        public static readonly Color Hero2 = Color.FromArgb(0x07, 0x08, 0x13);
        public static readonly Color Card = Color.FromArgb(0x15, 0x18, 0x2f);
        public static readonly Color CardEdge = Color.FromArgb(0x27, 0x2c, 0x55);
        public static readonly Color CardHover = Color.FromArgb(0x1d, 0x21, 0x40);
        public static readonly Color Text = Color.FromArgb(0xdd, 0xe1, 0xf5);
        public static readonly Color Head = Color.White;
        public static readonly Color Muted = Color.FromArgb(0x8a, 0x90, 0xb8);
        public static readonly Color Caption = Color.FromArgb(0x6f, 0x7c, 0xd6);
        public static readonly Color Blurple = Color.FromArgb(0x4f, 0x63, 0xf0);
        public static readonly Color Violet = Color.FromArgb(0x8b, 0x5c, 0xf6);
        public static readonly Color Cyan = Color.FromArgb(0x22, 0xe3, 0xf2);
        public static readonly Color Red = Color.FromArgb(0xf2, 0x4b, 0x5a);
        public static readonly Color Ok = Color.FromArgb(0x2d, 0xd4, 0x8f);
        public static readonly Color Warn = Color.FromArgb(0xf5, 0xb8, 0x3d);

        public static GraphicsPath Round(RectangleF r, float rad)
        {
            GraphicsPath p = new GraphicsPath();
            float d = Math.Min(rad * 2, Math.Min(r.Width, r.Height));
            if (d <= 0) { p.AddRectangle(r); return p; }
            p.AddArc(r.X, r.Y, d, d, 180, 90);
            p.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            p.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            p.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            p.CloseFigure();
            return p;
        }

        public static Color Mix(Color a, Color b, float t)
        {
            return Color.FromArgb((int)(a.A + (b.A - a.A) * t), (int)(a.R + (b.R - a.R) * t), (int)(a.G + (b.G - a.G) * t), (int)(a.B + (b.B - a.B) * t));
        }

        // a soft round light, for the neon glows
        public static void Glow(Graphics g, PointF c, float radius, Color col)
        {
            if (radius < 1) return;
            using (GraphicsPath p = new GraphicsPath())
            {
                p.AddEllipse(c.X - radius, c.Y - radius, radius * 2, radius * 2);
                using (PathGradientBrush b = new PathGradientBrush(p))
                {
                    b.CenterColor = col;
                    b.SurroundColors = new[] { Color.FromArgb(0, col) };
                    g.FillPath(b, p);
                }
            }
        }

        // a rounded card: fill + hairline edge
        public static void DrawCard(Graphics g, RectangleF r, float rad, Color fill, Color edge)
        {
            using (GraphicsPath p = Round(r, rad))
            {
                using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, p);
                using (Pen pen = new Pen(edge, 1f)) g.DrawPath(pen, p);
            }
        }
    }

    // custom-painted control base: double buffered, smooth, dragging moves the window if asked
    class Painted : Control
    {
        public bool DragsWindow;
        public Painted()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint |
                     ControlStyles.ResizeRedraw | ControlStyles.SupportsTransparentBackColor, true);
        }
        protected static float K(Graphics g) { return g.DpiX / 96f; }
        protected static void Smooth(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
        }
        protected void ClearBack(Graphics g)
        {
            using (SolidBrush b = new SolidBrush(Parent != null ? Parent.BackColor : Theme.Bg)) g.FillRectangle(b, ClientRectangle);
        }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (DragsWindow && e.Button == MouseButtons.Left) Win.Drag(FindForm());
        }
    }

    static class Win
    {
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool ReleaseCapture();
        [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
        [System.Runtime.InteropServices.DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr h, int attr, ref int val, int size);

        public static void Drag(Form f)
        {
            if (f == null) return;
            ReleaseCapture();
            SendMessage(f.Handle, 0xA1 /* WM_NCLBUTTONDOWN */, (IntPtr)2 /* HTCAPTION */, IntPtr.Zero);
        }

        // Windows 11 rounds the borderless window's corners; older Windows just ignores it
        public static void RoundCorners(IntPtr h)
        {
            try { int pref = 2; DwmSetWindowAttribute(h, 33 /* DWMWA_WINDOW_CORNER_PREFERENCE */, ref pref, 4); } catch { }
        }
    }

    // Left side: the logo on a deep navy panel with neon glows
    class Hero : Painted
    {
        Image logo;
        public string Tagline = "", Version = "", LinkText = "", LinkUrl = "";
        RectangleF linkRect;
        bool linkHover;

        public Hero()
        {
            DragsWindow = true;
            try
            {
                Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fightcord.logo.png");
                if (s != null) logo = Image.FromStream(s);
            }
            catch { }
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            Smooth(g);
            float k = K(g), w = Width, h = Height;
            if (w < 2 || h < 2) return;
            using (LinearGradientBrush b = new LinearGradientBrush(ClientRectangle, Theme.Hero1, Theme.Hero2, 90f)) g.FillRectangle(b, ClientRectangle);

            // faint dot grid
            using (SolidBrush dot = new SolidBrush(Color.FromArgb(16, 255, 255, 255)))
                for (float y = 10 * k; y < h; y += 20 * k)
                    for (float x = 10 * k; x < w; x += 20 * k) g.FillEllipse(dot, x, y, 1.6f * k, 1.6f * k);

            float size = w * 0.84f;
            RectangleF lr = new RectangleF((w - size) / 2, 96 * k, size, size);
            PointF c = new PointF(lr.X + lr.Width / 2, lr.Y + lr.Height * 0.5f);
            Theme.Glow(g, c, w * 0.62f, Color.FromArgb(120, Theme.Blurple));
            Theme.Glow(g, new PointF(c.X + w * 0.22f, c.Y - w * 0.2f), w * 0.34f, Color.FromArgb(70, Theme.Cyan));
            Theme.Glow(g, new PointF(c.X - w * 0.24f, c.Y + w * 0.24f), w * 0.32f, Color.FromArgb(70, Theme.Violet));
            if (logo != null) g.DrawImage(logo, lr);

            float y2 = lr.Bottom + 10 * k;
            TextRenderer.DrawText(g, Tagline, Font, new Rectangle(0, (int)y2, (int)w, (int)(22 * k)), Theme.Text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.NoPrefix);

            // version pill
            using (Font vf = new Font("Segoe UI Semibold", 8.5f))
            {
                Size ts = TextRenderer.MeasureText(Version, vf);
                RectangleF pill = new RectangleF((w - ts.Width - 20 * k) / 2, y2 + 32 * k, ts.Width + 20 * k, 22 * k);
                Theme.DrawCard(g, pill, 11 * k, Color.FromArgb(40, Theme.Cyan), Color.FromArgb(150, Theme.Cyan));
                TextRenderer.DrawText(g, Version, vf, Rectangle.Round(pill), Theme.Cyan,
                    TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.NoPrefix);
            }

            // link at the bottom
            using (Font lf = new Font("Segoe UI", 9f, linkHover ? FontStyle.Underline : FontStyle.Regular))
            {
                Size ts = TextRenderer.MeasureText(LinkText, lf);
                linkRect = new RectangleF((w - ts.Width) / 2, h - 44 * k, ts.Width, ts.Height);
                TextRenderer.DrawText(g, LinkText, lf, Point.Round(linkRect.Location), linkHover ? Theme.Head : Theme.Muted, TextFormatFlags.NoPrefix);
            }

            // neon edge towards the right side
            using (LinearGradientBrush edge = new LinearGradientBrush(new RectangleF(0, 0, 2, h), Color.FromArgb(0, Theme.Cyan), Color.FromArgb(0, Theme.Violet), 90f))
            {
                ColorBlend cb = new ColorBlend();
                cb.Colors = new[] { Color.FromArgb(0, Theme.Cyan), Color.FromArgb(200, Theme.Cyan), Color.FromArgb(200, Theme.Blurple), Color.FromArgb(160, Theme.Violet), Color.FromArgb(0, Theme.Violet) };
                cb.Positions = new[] { 0f, 0.25f, 0.5f, 0.75f, 1f };
                edge.InterpolationColors = cb;
                g.FillRectangle(edge, w - 1.5f * k, 0, 1.5f * k, h);
            }
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            bool over = linkRect.Contains(e.Location);
            if (over != linkHover) { linkHover = over; Cursor = over ? Cursors.Hand : Cursors.Default; Invalidate(); }
        }
        protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); if (linkHover) { linkHover = false; Cursor = Cursors.Default; Invalidate(); } }
        protected override void OnMouseDown(MouseEventArgs e)
        {
            if (e.Button == MouseButtons.Left && linkRect.Contains(e.Location))
            {
                try { Process.Start(new ProcessStartInfo(LinkUrl) { UseShellExecute = true }); } catch { }
                return;
            }
            base.OnMouseDown(e);
        }
    }

    // minimise / close in the top right corner
    class ChromeButton : Painted
    {
        bool close, hover;
        public ChromeButton(bool close) { this.close = close; Size = new Size(46, 34); Cursor = Cursors.Hand; }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            ClearBack(g);
            if (hover) using (SolidBrush b = new SolidBrush(close ? Theme.Red : Color.FromArgb(30, 255, 255, 255))) g.FillRectangle(b, ClientRectangle);
            Smooth(g);
            float k = K(g), cx = Width / 2f, cy = Height / 2f, s = 5 * k;
            using (Pen p = new Pen(hover ? Theme.Head : Theme.Muted, 1.2f * k))
            {
                if (close) { g.DrawLine(p, cx - s, cy - s, cx + s, cy + s); g.DrawLine(p, cx - s, cy + s, cx + s, cy - s); }
                else g.DrawLine(p, cx - s, cy, cx + s, cy);
            }
        }
        protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); hover = true; Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); hover = false; Invalidate(); }
    }

    enum ButtonKind { Primary, Ghost, Danger }

    // rounded button: Primary = blurple-to-violet gradient with a cyan rim on hover
    class GButton : Painted
    {
        ButtonKind kind;
        bool hover, down;
        public GButton(string text, ButtonKind kind)
        {
            this.kind = kind;
            Text = text;
            Cursor = Cursors.Hand;
            Font = new Font("Segoe UI Semibold", kind == ButtonKind.Primary ? 11f : 10f);
            Height = 46;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            ClearBack(g);
            Smooth(g);
            float k = K(g);
            RectangleF r = new RectangleF(1, 1, Width - 3, Height - 3);
            Color text;
            using (GraphicsPath p = Theme.Round(r, 10 * k))
            {
                if (!Enabled)
                {
                    using (SolidBrush b = new SolidBrush(Theme.Card)) g.FillPath(b, p);
                    using (Pen pen = new Pen(Theme.CardEdge)) g.DrawPath(pen, p);
                    text = Color.FromArgb(0x5a, 0x60, 0x88);
                }
                else if (kind == ButtonKind.Primary)
                {
                    Color a = hover ? Theme.Mix(Theme.Blurple, Theme.Cyan, 0.22f) : Theme.Blurple;
                    Color b2 = hover ? Theme.Mix(Theme.Violet, Theme.Blurple, 0.2f) : Theme.Violet;
                    using (LinearGradientBrush b = new LinearGradientBrush(r, a, b2, 0f)) g.FillPath(b, p);
                    // glossy top half
                    using (GraphicsPath top = Theme.Round(new RectangleF(r.X, r.Y, r.Width, r.Height / 2), 10 * k))
                    using (SolidBrush b = new SolidBrush(Color.FromArgb(28, 255, 255, 255))) g.FillPath(b, top);
                    using (Pen pen = new Pen(hover ? Theme.Cyan : Color.FromArgb(90, 255, 255, 255), hover ? 1.5f * k : 1f)) g.DrawPath(pen, p);
                    text = Color.White;
                }
                else
                {
                    bool danger = kind == ButtonKind.Danger;
                    Color fill = hover ? (danger ? Color.FromArgb(46, Theme.Red) : Theme.CardHover) : Theme.Card;
                    Color edge = hover ? (danger ? Theme.Red : Color.FromArgb(160, Theme.Cyan)) : Theme.CardEdge;
                    using (SolidBrush b = new SolidBrush(fill)) g.FillPath(b, p);
                    using (Pen pen = new Pen(edge)) g.DrawPath(pen, p);
                    text = danger ? Theme.Red : Theme.Text;
                }
                if (down && Enabled) using (SolidBrush b = new SolidBrush(Color.FromArgb(40, 0, 0, 0))) g.FillPath(b, p);
            }
            TextRenderer.DrawText(g, Text, Font, ClientRectangle, text,
                TextFormatFlags.HorizontalCenter | TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        }
        protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); hover = true; Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); hover = down = false; Invalidate(); }
        protected override void OnMouseDown(MouseEventArgs e) { base.OnMouseDown(e); down = true; Invalidate(); }
        protected override void OnMouseUp(MouseEventArgs e) { base.OnMouseUp(e); down = false; Invalidate(); }
        protected override void OnEnabledChanged(EventArgs e) { base.OnEnabledChanged(e); Cursor = Enabled ? Cursors.Hand : Cursors.Default; Invalidate(); }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }
    }

    // the Fightcade folder, in a card with a folder glyph
    class PathView : Painted
    {
        public bool Missing;
        public PathView() { Font = new Font("Segoe UI", 10f); Height = 46; }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            ClearBack(g);
            Smooth(g);
            float k = K(g);
            Theme.DrawCard(g, new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 10 * k, Theme.Card, Missing ? Color.FromArgb(160, Theme.Warn) : Theme.CardEdge);
            // folder glyph
            float x = 16 * k, cy = Height / 2f;
            using (Pen p = new Pen(Missing ? Theme.Warn : Theme.Cyan, 1.5f * k))
            using (GraphicsPath f = new GraphicsPath())
            {
                f.AddLines(new[] { new PointF(x, cy - 6 * k), new PointF(x + 6 * k, cy - 6 * k), new PointF(x + 8 * k, cy - 4 * k),
                    new PointF(x + 16 * k, cy - 4 * k), new PointF(x + 16 * k, cy + 7 * k), new PointF(x, cy + 7 * k) });
                f.CloseFigure();
                g.DrawPath(p, f);
            }
            Rectangle tr = new Rectangle((int)(44 * k), 0, Width - (int)(56 * k), Height);
            TextRenderer.DrawText(g, Text, Font, tr, Missing ? Theme.Warn : Theme.Text,
                TextFormatFlags.VerticalCenter | TextFormatFlags.PathEllipsis | TextFormatFlags.NoPrefix | TextFormatFlags.SingleLine);
        }
        protected override void OnTextChanged(EventArgs e) { base.OnTextChanged(e); Invalidate(); }
    }

    // status lines, each with a round icon: y = done, i = info, ! = warning, x = problem
    class StatusView : Painted
    {
        List<KeyValuePair<char, string>> lines = new List<KeyValuePair<char, string>>();
        public StatusView() { Font = new Font("Segoe UI", 9.75f); }
        public void SetLines(List<KeyValuePair<char, string>> l) { lines = l; Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            ClearBack(g);
            Smooth(g);
            float k = K(g);
            Theme.DrawCard(g, new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 12 * k, Theme.Card, Theme.CardEdge);
            float lh = 23 * k, y = (Height - lines.Count * lh) / 2;
            foreach (KeyValuePair<char, string> ln in lines)
            {
                float cx = 26 * k, cy = y + lh / 2, r = 8 * k;
                Color col = ln.Key == 'y' ? Theme.Ok : ln.Key == '!' ? Theme.Warn : ln.Key == 'x' ? Theme.Red : Theme.Blurple;
                Theme.Glow(g, new PointF(cx, cy), r * 2f, Color.FromArgb(60, col));
                using (SolidBrush b = new SolidBrush(col)) g.FillEllipse(b, cx - r, cy - r, r * 2, r * 2);
                using (Pen p = new Pen(ln.Key == '!' ? Theme.Hero2 : Color.White, 1.6f * k))
                {
                    p.StartCap = p.EndCap = LineCap.Round;
                    if (ln.Key == 'y') g.DrawLines(p, new[] { new PointF(cx - 3.5f * k, cy), new PointF(cx - 1 * k, cy + 2.8f * k), new PointF(cx + 3.8f * k, cy - 2.8f * k) });
                    else if (ln.Key == 'x') { g.DrawLine(p, cx - 3 * k, cy - 3 * k, cx + 3 * k, cy + 3 * k); g.DrawLine(p, cx - 3 * k, cy + 3 * k, cx + 3 * k, cy - 3 * k); }
                    else if (ln.Key == '!') { g.DrawLine(p, cx, cy - 4 * k, cx, cy + 0.8f * k); g.DrawLine(p, cx, cy + 3.6f * k, cx, cy + 3.8f * k); }
                    else using (SolidBrush b = new SolidBrush(Color.White)) g.FillEllipse(b, cx - 2.2f * k, cy - 2.2f * k, 4.4f * k, 4.4f * k);
                }
                TextRenderer.DrawText(g, ln.Value, Font, new Rectangle((int)(46 * k), (int)y, Width - (int)(58 * k), (int)lh),
                    ln.Key == '!' ? Theme.Warn : Theme.Text, TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
                y += lh;
            }
        }
    }

    // what you get: two columns of short items with a neon diamond each
    class Features : Painted
    {
        public string[] Items = new string[0];
        public Features() { Font = new Font("Segoe UI", 9.5f); }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            ClearBack(g);
            Smooth(g);
            float k = K(g);
            int rows = (Items.Length + 1) / 2;
            if (rows == 0) return;
            float colW = Width / 2f, rowH = (float)Height / rows;
            for (int i = 0; i < Items.Length; i++)
            {
                float x = (i % 2) * colW, y = (i / 2) * rowH, cx = x + 7 * k, cy = y + rowH / 2, s = 4 * k;
                Color col = i % 3 == 0 ? Theme.Cyan : i % 3 == 1 ? Theme.Blurple : Theme.Violet;
                Theme.Glow(g, new PointF(cx, cy), 9 * k, Color.FromArgb(90, col));
                using (SolidBrush b = new SolidBrush(col))
                    g.FillPolygon(b, new[] { new PointF(cx, cy - s), new PointF(cx + s, cy), new PointF(cx, cy + s), new PointF(cx - s, cy) });
                TextRenderer.DrawText(g, Items[i], Font, new Rectangle((int)(x + 22 * k), (int)y, (int)(colW - 26 * k), (int)rowH), Theme.Text,
                    TextFormatFlags.VerticalCenter | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
            }
        }
    }

    // slim bar: a sliding cyan-to-violet streak while working, full when done
    class Progress : Painted
    {
        System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 15 };
        float pos;
        int state;          // 0 idle, 1 busy, 2 done, 3 failed
        public Progress()
        {
            Height = 4;
            timer.Tick += delegate { pos += 0.012f; if (pos > 1.4f) pos = -0.4f; Invalidate(); };
        }
        public void Busy() { state = 1; pos = -0.4f; timer.Start(); Invalidate(); }
        public void Finish(bool ok) { timer.Stop(); state = ok ? 2 : 3; Invalidate(); }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            ClearBack(g);
            if (state == 0) return;
            Smooth(g);
            RectangleF r = new RectangleF(0, 0, Width, Height);
            using (GraphicsPath track = Theme.Round(r, Height / 2f))
            using (SolidBrush b = new SolidBrush(Theme.Card)) g.FillPath(b, track);
            RectangleF bar = state == 1 ? new RectangleF(Width * pos, 0, Width * 0.4f, Height) : r;
            bar.Intersect(r);
            if (bar.Width < 1) return;
            Color a = state == 3 ? Theme.Red : Theme.Cyan, b2 = state == 3 ? Theme.Red : Theme.Violet;
            using (GraphicsPath p = Theme.Round(bar, Height / 2f))
            using (LinearGradientBrush lb = new LinearGradientBrush(new RectangleF(bar.X - 1, 0, bar.Width + 2, Height), a, b2, 0f))
                g.FillPath(lb, p);
        }
        protected override void Dispose(bool disposing) { if (disposing) timer.Dispose(); base.Dispose(disposing); }
    }

    // a rounded card that holds other controls
    class CardPanel : Panel
    {
        public CardPanel()
        {
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            BackColor = Theme.Card;
        }
        protected override void OnPaint(PaintEventArgs e)
        {
            Graphics g = e.Graphics;
            using (SolidBrush b = new SolidBrush(Parent != null ? Parent.BackColor : Theme.Bg)) g.FillRectangle(b, ClientRectangle);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            float k = g.DpiX / 96f;
            Theme.DrawCard(g, new RectangleF(0.5f, 0.5f, Width - 1.5f, Height - 1.5f), 10 * k, Theme.Card, Theme.CardEdge);
        }
    }

    class SetupForm : Form
    {
        const string Version = "2.9.0";
        const string ReleasesUrl = "https://github.com/JillTheStingray/fightcord/releases/latest";
        const string Marker = "/* Fightcord loader */";

        string root;               // ...\Fightcade
        PathView pathBox;
        StatusView status;
        TextBox log;
        Progress progress;
        GButton installBtn, uninstallBtn, launchBtn, browseBtn;
        List<Control> busyLock = new List<Control>();
        bool headless, headlessRestore, failed;
        StringBuilder headlessLog = new StringBuilder();

        string App { get { return Path.Combine(root, "fc2-electron", "resources", "app"); } }
        string Inject { get { return Path.Combine(App, "inject"); } }
        string FcordDir { get { return Path.Combine(Inject, "fightcord"); } }
        string OldPlugins { get { return Path.Combine(Inject, "plugins"); } }
        string BackupRoot { get { return Path.Combine(App, "fightcord-backup"); } }

        // borderless, but with a shadow and a taskbar minimise
        protected override CreateParams CreateParams
        {
            get
            {
                CreateParams cp = base.CreateParams;
                cp.ClassStyle |= 0x20000;   // CS_DROPSHADOW
                cp.Style |= 0x20000;        // WS_MINIMIZEBOX
                return cp;
            }
        }

        protected override void OnHandleCreated(EventArgs e) { base.OnHandleCreated(e); Win.RoundCorners(Handle); }

        public SetupForm(string rootArg, bool headless)
        {
            SuspendLayout();
            Text = L.T("Fightcord Setup");
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            ClientSize = new Size(900, 640);
            FormBorderStyle = FormBorderStyle.None;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Theme.Bg;
            ForeColor = Theme.Text;
            Font = new Font("Segoe UI", 9.5f);
            DoubleBuffered = true;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            MouseDown += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) Win.Drag(this); };

            Hero hero = new Hero
            {
                Location = new Point(0, 0), Size = new Size(340, 640), Font = new Font("Segoe UI", 10f),
                Tagline = L.T("The Discord-style suite for Fightcade"), Version = "v" + Version,
                LinkText = L.T("Newest version on GitHub") + "  \u2197", LinkUrl = ReleasesUrl
            };
            Controls.Add(hero);

            ChromeButton min = new ChromeButton(false) { Location = new Point(900 - 92, 0) };
            ChromeButton close = new ChromeButton(true) { Location = new Point(900 - 46, 0) };
            min.Click += delegate { WindowState = FormWindowState.Minimized; };
            close.Click += delegate { Close(); };
            Controls.Add(min); Controls.Add(close);

            const int X = 372, W = 500;
            Label title = new Label { Text = L.T("Set up Fightcord"), Font = new Font("Segoe UI Semibold", 21f), ForeColor = Theme.Head, AutoSize = true, Location = new Point(X - 3, 34) };
            Label sub = new Label { Text = L.T("Discord-style chat, a new search tab, stats and more \u2014 in one click."), ForeColor = Theme.Muted, AutoSize = true, Location = new Point(X, 80) };
            title.MouseDown += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) Win.Drag(this); };
            Controls.Add(title); Controls.Add(sub);

            Controls.Add(Caption(L.T("FIGHTCADE FOLDER"), X, 122));
            pathBox = new PathView { Location = new Point(X, 142), Size = new Size(W - 114, 46) };
            browseBtn = new GButton(L.T("Browse\u2026"), ButtonKind.Ghost) { Location = new Point(X + W - 104, 142), Size = new Size(104, 46) };
            browseBtn.Click += delegate { Browse(); };
            Controls.Add(pathBox); Controls.Add(browseBtn);

            Controls.Add(Caption(L.T("STATUS"), X, 204));
            status = new StatusView { Location = new Point(X, 224), Size = new Size(W, 104) };
            Controls.Add(status);

            Controls.Add(Caption(L.T("WHAT YOU GET"), X, 344));
            Features feats = new Features
            {
                Location = new Point(X, 362), Size = new Size(W, 104),
                Items = new[] {
                    L.T("Discord theme, chat & member list"), L.T("Discover tab with live matches"),
                    L.T("Translate, mentions & :emoji:"), L.T("Scout card with ELO & win odds"),
                    L.T("Challenge card, filters & rematch"), L.T("VS screens, stats & replays"),
                    L.T("Friends, notes & hover cards"), L.T("Themes, music, Rich Presence & updates") }
            };
            Controls.Add(feats);
            Label note = new Label
            {
                Text = L.T("Cerberus is backed up and removed. Your settings and match history come along."),
                ForeColor = Theme.Muted, Location = new Point(X, 470), Size = new Size(W, 20)
            };
            Controls.Add(note);

            installBtn = new GButton(L.T("Install"), ButtonKind.Primary) { Location = new Point(X, 500), Size = new Size(200, 48) };
            launchBtn = new GButton(L.T("Open Fightcade"), ButtonKind.Ghost) { Location = new Point(X + 212, 500), Size = new Size(158, 48) };
            uninstallBtn = new GButton(L.T("Uninstall"), ButtonKind.Danger) { Location = new Point(X + 382, 500), Size = new Size(118, 48) };
            installBtn.Click += delegate { if (installBtn.Enabled) Run(DoInstall); };
            uninstallBtn.Click += delegate { if (uninstallBtn.Enabled) Run(DoUninstall); };
            launchBtn.Click += delegate { if (launchBtn.Enabled) Launch(); };
            Controls.Add(installBtn); Controls.Add(launchBtn); Controls.Add(uninstallBtn);
            busyLock.AddRange(new Control[] { installBtn, uninstallBtn, launchBtn, browseBtn });

            progress = new Progress { Location = new Point(X, 560), Size = new Size(W, 4) };
            Controls.Add(progress);
            CardPanel logCard = new CardPanel { Location = new Point(X, 572), Size = new Size(W, 52), Padding = new Padding(12, 7, 12, 5) };
            log = new TextBox { Dock = DockStyle.Fill, Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.None, BorderStyle = BorderStyle.None,
                BackColor = Theme.Card, ForeColor = Theme.Muted, Font = new Font("Consolas", 8.75f), TabStop = false };
            logCard.Controls.Add(log);
            Controls.Add(logCard);
            ResumeLayout(false);

            this.headless = headless;
            root = rootArg != null ? RootFrom(rootArg) : FindFightcade();
            Refresh2();
            if (!headless) Log(L.T("Ready."));
        }

        // fade in
        protected override void OnShown(EventArgs e)
        {
            base.OnShown(e);
            Opacity = 0;
            System.Windows.Forms.Timer t = new System.Windows.Forms.Timer { Interval = 15 };
            t.Tick += delegate { Opacity = Math.Min(1, Opacity + 0.08); if (Opacity >= 1) { t.Stop(); t.Dispose(); } };
            t.Start();
        }

        public int Headless(string mode, bool restore, string logFile)
        {
            headlessRestore = restore;
            int code = 0;
            try
            {
                if (root == null) throw new Exception(L.T("Fightcade folder not found"));
                if (FightcadeRunning()) throw new Exception(L.T("Fightcade is running - close it first"));
                if (mode == "install") DoInstall(); else DoUninstall();
            }
            catch (Exception ex) { Log("ERROR " + ex.Message); code = 1; }
            if (logFile != null) File.WriteAllText(logFile, headlessLog.ToString());
            return code;
        }

        Label Caption(string text, int x, int y)
        {
            Label l = new Label { Text = text, Location = new Point(x, y), AutoSize = true, ForeColor = Theme.Caption, Font = new Font("Segoe UI Semibold", 8f) };
            l.MouseDown += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) Win.Drag(this); };
            return l;
        }

        void Log(string s)
        {
            if (headless) { headlessLog.AppendLine(s); return; }
            if (InvokeRequired) { BeginInvoke(new Action<string>(Log), s); return; }
            log.AppendText((log.TextLength > 0 ? Environment.NewLine : "") + s);
            log.SelectionStart = log.TextLength;
            log.ScrollToCaret();
        }

        // ------------------------------------------------------------ finding Fightcade

        static bool IsRoot(string dir)
        {
            return !string.IsNullOrEmpty(dir) && File.Exists(Path.Combine(dir, "fc2-electron", "resources", "app", "lib", "preload.js"));
        }

        // accepts the Fightcade folder itself or anything inside it
        static string RootFrom(string dir)
        {
            try
            {
                DirectoryInfo d = new DirectoryInfo(dir);
                while (d != null) { if (IsRoot(d.FullName)) return d.FullName; d = d.Parent; }
            }
            catch { }
            return null;
        }

        static string FindFightcade()
        {
            string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            List<string> tries = new List<string> {
                Path.Combine(docs, "Fightcade"),
                Path.Combine(home, "OneDrive", "Documenten", "Fightcade"),
                Path.Combine(home, "OneDrive", "Documents", "Fightcade"),
                Path.Combine(home, "Documents", "Fightcade"),
                Path.Combine(home, "Desktop", "Fightcade"),
                @"C:\Fightcade", @"C:\Fightcade2", @"D:\Fightcade", @"C:\Games\Fightcade", @"D:\Games\Fightcade"
            };
            // a running Fightcade knows where it lives
            foreach (Process p in Process.GetProcessesByName("fc2-electron"))
            {
                try { tries.Insert(0, Path.GetDirectoryName(p.MainModule.FileName)); } catch { }
            }
            foreach (string t in tries) { string r = RootFrom(t); if (r != null) return r; }
            return null;
        }

        void Browse()
        {
            using (FolderBrowserDialog d = new FolderBrowserDialog())
            {
                d.Description = L.T("Pick your Fightcade folder (the one with Fightcade2.exe in it).");
                if (d.ShowDialog(this) != DialogResult.OK) return;
                string r = RootFrom(d.SelectedPath);
                if (r == null) { MessageBox.Show(this, L.T("That doesn't look like a Fightcade folder.\n\nPick the folder that contains Fightcade2.exe and fc2-electron."), "Fightcord", MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
                root = r;
                Refresh2();
            }
        }

        // ------------------------------------------------------------------ state

        string InstalledVersion()
        {
            try
            {
                string m = File.ReadAllText(Path.Combine(FcordDir, "fightcord.json"));
                Match v = Regex.Match(m, "\"version\"\\s*:\\s*\"([^\"]+)\"");
                return v.Success ? v.Groups[1].Value : "?";
            }
            catch { return null; }
        }

        bool OurLoader()
        {
            try { return File.ReadAllText(Path.Combine(Inject, "inject.js")).Contains(Marker); } catch { return false; }
        }

        bool HasCerberus()
        {
            return File.Exists(Path.Combine(OldPlugins, "cerberus.js")) || Directory.Exists(Path.Combine(OldPlugins, "cerberus"));
        }

        bool HasOldSetup()
        {
            return Directory.Exists(OldPlugins) || (File.Exists(Path.Combine(Inject, "inject.js")) && !OurLoader());
        }

        string LatestBackup()
        {
            if (!Directory.Exists(BackupRoot)) return null;
            return Directory.GetDirectories(BackupRoot).Where(d => !Path.GetFileName(d).StartsWith("uninstall-"))
                .OrderByDescending(d => d).FirstOrDefault();
        }

        // Fightcade processes of THIS install (another copy elsewhere doesn't matter)
        List<Process> FightcadeProcs()
        {
            List<Process> list = new List<Process>();
            foreach (Process p in Process.GetProcessesByName("fc2-electron"))
            {
                string file = null;
                try { file = p.MainModule.FileName; } catch { }
                if (file == null || root == null || file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) list.Add(p);
            }
            return list;
        }

        bool FightcadeRunning() { return FightcadeProcs().Count > 0; }

        static bool EmulatorRunning()
        {
            foreach (string n in new[] { "fcadefbneo", "flycast", "ggpofba", "ggpofba-ng", "fcadesnes", "fcv39", "fcadeps1", "duckstation" })
                if (Process.GetProcessesByName(n).Length > 0) return true;
            return false;
        }

        void Refresh2()
        {
            List<KeyValuePair<char, string>> lines = new List<KeyValuePair<char, string>>();
            pathBox.Missing = root == null;
            pathBox.Text = root ?? L.T("Not found \u2014 click Browse");
            if (root == null)
            {
                lines.Add(new KeyValuePair<char, string>('!', L.T("Fightcade wasn't found automatically.")));
                lines.Add(new KeyValuePair<char, string>('i', L.T("Click Browse and pick the folder with Fightcade2.exe in it.")));
                status.SetLines(lines);
                installBtn.Enabled = uninstallBtn.Enabled = launchBtn.Enabled = false;
                return;
            }
            string v = InstalledVersion();
            bool ours = OurLoader() && v != null;
            lines.Add(new KeyValuePair<char, string>('y', L.T("Fightcade found.")));
            if (ours) lines.Add(new KeyValuePair<char, string>('y', v == Version ? L.F("Fightcord {0} is installed \u2014 up to date.", v) : L.F("Fightcord {0} is installed \u2014 this setup has {1}.", v, Version)));
            else lines.Add(new KeyValuePair<char, string>('i', L.T("Fightcord is not installed yet.")));
            if (HasCerberus()) lines.Add(new KeyValuePair<char, string>('i', L.T("Cerberus found \u2014 it will be backed up and removed.")));
            else if (HasOldSetup()) lines.Add(new KeyValuePair<char, string>('i', L.T("An older plugin setup was found \u2014 it will be backed up and replaced.")));
            if (FightcadeRunning()) lines.Add(new KeyValuePair<char, string>('!', L.T("Fightcade is open \u2014 it has to be closed to install.")));
            status.SetLines(lines);
            installBtn.Text = ours ? (v == Version ? L.T("Repair") : L.F("Update to {0}", Version)) : L.T("Install");
            installBtn.Enabled = true;
            uninstallBtn.Enabled = ours;
            launchBtn.Enabled = FindExe() != null;
        }

        string FindExe()
        {
            if (root == null) return null;
            foreach (string n in new[] { "Fightcade2.exe", "fightcade2.exe", "Fightcade.exe" })
            {
                string p = Path.Combine(root, n);
                if (File.Exists(p)) return p;
            }
            return null;
        }

        void Launch()
        {
            string exe = FindExe();
            if (exe == null) return;
            try { Process.Start(new ProcessStartInfo(exe) { WorkingDirectory = root, UseShellExecute = true }); }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "Fightcord"); }
        }

        // ----------------------------------------------------------------- running

        bool EnsureClosed()
        {
            if (!FightcadeRunning()) return true;
            if (EmulatorRunning())
            {
                MessageBox.Show(this, L.T("A match or emulator is still running.\n\nFinish it, close Fightcade (right-click its tray icon \u2192 Quit), then try again."), "Fightcord", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return false;
            }
            DialogResult r = MessageBox.Show(this, L.T("Fightcade is open and has to be closed first.\n\nClose it now?"), "Fightcord", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
            if (r != DialogResult.Yes) return false;
            foreach (Process p in FightcadeProcs()) { try { p.Kill(); } catch { } }
            for (int i = 0; i < 40 && FightcadeRunning(); i++) Thread.Sleep(150);
            Thread.Sleep(400);          // let Windows release the files
            return !FightcadeRunning();
        }

        void Run(Action work)
        {
            if (root == null) return;
            if (!EnsureClosed()) { Refresh2(); return; }
            foreach (Control c in busyLock) c.Enabled = false;
            log.Clear();
            failed = false;
            progress.Busy();
            Thread t = new Thread(delegate ()
            {
                try { work(); }
                catch (Exception ex) { failed = true; Log("\u2716 " + ex.Message); Log(L.F("Nothing is lost: see {0}", BackupRoot)); }
                BeginInvoke(new Action(delegate { progress.Finish(!failed); Refresh2(); }));
            });
            t.IsBackground = true;
            t.Start();
        }

        // ----------------------------------------------------------------- install

        // our plugins' data files, which move from inject\plugins\ to inject\fightcord\
        static readonly string[] DataFiles = {
            "chat-extras-config.json", "discord-theme-config.json", "discover-config.json", "emoji-config.json",
            "fontstyle-config.json", "match-screens-config.json", "member-list-config.json", "scout-config.json",
            "translate-config.json", "discord-rpc-config.json", "match-history.json",
            "challenge-filters-config.json", "fightcord-state.json",
            "friends-config.json", "notes-config.json", "challenge-card-config.json", "channel-banner-config.json",
            "hover-cards-config.json", "backgrounds-config.json", "music-config.json", "fightcord-core-config.json",
            "theme-background.png", "theme-background.jpg", "theme-background.gif", "theme-background.webp",
            "rank-history.json", "goals-config.json", "progress-config.json", "analytics-config.json",
            "feed-config.json", "feed-history.json", "welcome-config.json", "events-config.json",
            "find-match-config.json", "streamer-config.json", "login-screen-config.json", "emu-skin-config.json"
        };
        
        void DoInstall()
        {
            Log("Fightcade: " + root);
            Directory.CreateDirectory(Inject);

            if (HasOldSetup())
            {
                // Moved, not copied: one rename, no matter how deep node_modules goes
                // (a file-by-file copy trips the 260-character path limit there).
                bool cerb = HasCerberus();
                string bk = Path.Combine(BackupRoot, DateTime.Now.ToString("yyyyMMdd-HHmmss"));
                Directory.CreateDirectory(bk);
                Log(L.F("Backing up the current setup to {0}", bk));
                string oldLoader = Path.Combine(Inject, "inject.js");
                if (File.Exists(oldLoader) && !OurLoader()) File.Copy(oldLoader, Path.Combine(bk, "inject.js"), true);
                string oldCfg = Path.Combine(Inject, "config.json");
                if (File.Exists(oldCfg)) File.Move(oldCfg, Path.Combine(bk, "config.json"));
                string was = Path.Combine(bk, "plugins");
                if (Directory.Exists(OldPlugins)) Directory.Move(OldPlugins, was);

                Directory.CreateDirectory(FcordDir);
                Log(L.T("Bringing your settings and match history along"));
                foreach (string f in DataFiles)
                {
                    string src = Path.Combine(was, f), dst = Path.Combine(FcordDir, f);
                    if (File.Exists(src) && !File.Exists(dst)) { File.Copy(src, dst); Log("  " + f); }
                }
                string sounds = Path.Combine(was, "match-screens"), soundsTo = Path.Combine(FcordDir, "match-screens");
                if (Directory.Exists(sounds) && !Directory.Exists(soundsTo)) { CopyDir(sounds, soundsTo, null); Log("  match-screens\\ (" + L.T("your sounds") + ")"); }
                string snaps = Path.Combine(was, "fc-snapshots"), snapsTo = Path.Combine(FcordDir, "fc-snapshots");
                if (Directory.Exists(snaps) && !Directory.Exists(snapsTo)) { Directory.Move(snaps, snapsTo); Log("  fc-snapshots\\"); }

                Log(L.T(cerb ? "Cerberus and the old loader are out (kept in the backup)" : "The old loader is out (kept in the backup)"));
            }

            Log(L.F("Installing Fightcord {0}", Version));
            Directory.CreateDirectory(FcordDir);
            int n = 0;
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("Fightcord.payload.zip"))
            {
                if (s == null) throw new Exception(L.T("The installer is missing its files (payload.zip). Rebuild it with build.ps1."));
                using (ZipArchive zip = new ZipArchive(s, ZipArchiveMode.Read))
                {
                    foreach (ZipArchiveEntry e in zip.Entries)
                    {
                        string rel = e.FullName.Replace('/', '\\');
                        if (rel.EndsWith("\\")) continue;
                        string dst = Path.GetFullPath(Path.Combine(Inject, rel));
                        if (!dst.StartsWith(Path.GetFullPath(Inject), StringComparison.OrdinalIgnoreCase)) continue;
                        Directory.CreateDirectory(Path.GetDirectoryName(dst));
                        using (Stream from = e.Open())
                        using (FileStream to = File.Create(dst)) from.CopyTo(to);
                        n++;
                    }
                }
            }
            Log("  " + L.F("{0} files", n));
            WriteManifest();
            Log("");
            Log("\u2714 " + L.T("Done. Open Fightcade - everything is under Settings \u2192 Fightcord and the other blocks."));
        }

        void WriteManifest()
        {
            string path = Path.Combine(FcordDir, "fightcord.json");
            string off = "[]", disabled = "false", splash = "true";
            try
            {
                string old = File.ReadAllText(path);
                Match m = Regex.Match(old, "\"off\"\\s*:\\s*(\\[[^\\]]*\\])");
                if (m.Success) off = m.Groups[1].Value;
                Match d = Regex.Match(old, "\"disabled\"\\s*:\\s*(true|false)");
                if (d.Success) disabled = d.Groups[1].Value;
                Match sp = Regex.Match(old, "\"splash\"\\s*:\\s*(true|false)");
                if (sp.Success) splash = sp.Groups[1].Value;
            }
            catch { }
            File.WriteAllText(path, "{\n  \"version\": \"" + Version + "\",\n  \"installedAt\": \"" + DateTime.Now.ToString("s") +
                "\",\n  \"disabled\": " + disabled + ",\n  \"splash\": " + splash + ",\n  \"off\": " + off + "\n}\n");
        }

        // --------------------------------------------------------------- uninstall

        // emu-skin.js swaps the emulator's bar images and font (emulator\fbneo\ui) and keeps Fightcade's in
        // fightcord\emu-ui-original. Put them back -- only files that are still the ones Fightcord
        // wrote (its config lists their sha256), so a Fightcade update's newer files are left alone.
        void RestoreEmulatorUi()
        {
            try
            {
                string bak = Path.Combine(FcordDir, "emu-ui-original");
                string cfg = Path.Combine(FcordDir, "emu-skin-config.json");
                if (!Directory.Exists(bak) || !File.Exists(cfg)) return;
                Match w = Regex.Match(File.ReadAllText(cfg), "\"written\"\\s*:\\s*\\{([^}]*)\\}");
                if (!w.Success) return;
                string ui = Path.Combine(root, "emulator", "fbneo", "ui");
                foreach (Match m in Regex.Matches(w.Groups[1].Value, "\"([\\w.-]+\\.(?:png|fnt))\"\\s*:\\s*\"([0-9a-f]{64})\""))
                {
                    string f = m.Groups[1].Value, live = Path.Combine(ui, f), orig = Path.Combine(bak, f);
                    if (!File.Exists(live) || !File.Exists(orig)) continue;
                    string have;
                    using (var sha = System.Security.Cryptography.SHA256.Create())
                    using (var s = File.OpenRead(live))
                        have = BitConverter.ToString(sha.ComputeHash(s)).Replace("-", "").ToLowerInvariant();
                    if (have != m.Groups[2].Value) continue;
                    File.Copy(orig, live, true);
                    Log(L.F("Restored the emulator's {0}", f));
                }
            }
            catch (Exception e) { Log("  " + e.Message); }
        }

        void DoUninstall()
        {
            string prev = LatestBackup();
            bool restore = false;
            if (headless) restore = headlessRestore && prev != null;
            else Invoke(new Action(delegate
            {
                DialogResult r = MessageBox.Show(this, L.T("Remove Fightcord from Fightcade?") +
                    (prev != null ? "\n\n" + L.F("Your previous setup (Cerberus / old plugins) from {0} can be put back. Restore it?", Path.GetFileName(prev)) + "\n\n" + L.T("Yes = remove and restore   No = just remove") : ""),
                    "Fightcord", prev != null ? MessageBoxButtons.YesNoCancel : MessageBoxButtons.OKCancel, MessageBoxIcon.Question);
                if (r == DialogResult.Cancel) { prev = "cancel"; return; }
                restore = r == DialogResult.Yes;
            }));
            if (prev == "cancel") { Log(L.T("Cancelled.")); return; }

            string keep = Path.Combine(BackupRoot, "uninstall-" + DateTime.Now.ToString("yyyyMMdd-HHmmss"));
            Log(L.F("Keeping your settings and match history in {0}", keep));
            Directory.CreateDirectory(keep);
            foreach (string f in DataFiles.Concat(new[] { "fightcord.json" }))
            {
                string src = Path.Combine(FcordDir, f);
                if (File.Exists(src)) File.Copy(src, Path.Combine(keep, f), true);
            }
            string sounds = Path.Combine(FcordDir, "match-screens");
            if (Directory.Exists(sounds)) CopyDir(sounds, Path.Combine(keep, "match-screens"), null);
            string music = Path.Combine(FcordDir, "music");
            if (Directory.Exists(music)) CopyDir(music, Path.Combine(keep, "music"), null);

            RestoreEmulatorUi();
            Log(L.T("Removing Fightcord"));
            if (Directory.Exists(FcordDir)) Directory.Delete(FcordDir, true);
            string loader = Path.Combine(Inject, "inject.js");
            if (OurLoader()) File.Delete(loader);

            if (restore && prev != null)
            {
                Log(L.F("Restoring {0}", prev));
                if (File.Exists(Path.Combine(prev, "inject.js"))) File.Copy(Path.Combine(prev, "inject.js"), loader, true);
                if (File.Exists(Path.Combine(prev, "config.json"))) File.Copy(Path.Combine(prev, "config.json"), Path.Combine(Inject, "config.json"), true);
                string prevPlugins = Path.Combine(prev, "plugins");
                if (Directory.Exists(prevPlugins))
                {
                    if (Directory.Exists(OldPlugins)) Directory.Delete(OldPlugins, true);
                    Directory.Move(prevPlugins, OldPlugins);      // a rename, like the backup
                }
            }
            Log("");
            Log("\u2714 " + L.T("Fightcord removed.") + " " + L.T(restore ? "Your previous setup is back." : "Fightcade runs plain."));
        }

        // ------------------------------------------------------------------ helpers

        static void CopyDir(string src, string dst, string skip)
        {
            Directory.CreateDirectory(dst);
            foreach (string f in Directory.GetFiles(src)) File.Copy(f, Path.Combine(dst, Path.GetFileName(f)), true);
            foreach (string d in Directory.GetDirectories(src))
            {
                if (skip != null && string.Equals(Path.GetFileName(d), skip, StringComparison.OrdinalIgnoreCase)) continue;
                CopyDir(d, Path.Combine(dst, Path.GetFileName(d)), null);
            }
        }
    }

    // ---- i18n tables (generated by installer/make_i18n.js from i18n.json; do not edit) ----
    static partial class L
    {
        static readonly Dictionary<string, string> Pt = new Dictionary<string, string>
        {
            { "Fightcord Setup", "Instala\u00e7\u00e3o do Fightcord" },
            { "The Discord-style suite for Fightcade", "O pacote estilo Discord para o Fightcade" },
            { "Newest version on GitHub", "Vers\u00e3o mais nova no GitHub" },
            { "Set up Fightcord", "Instalar o Fightcord" },
            { "Discord-style chat, a new search tab, stats and more \u2014 in one click.", "Chat estilo Discord, uma nova aba de busca, estat\u00edsticas e mais \u2014 em um clique." },
            { "FIGHTCADE FOLDER", "PASTA DO FIGHTCADE" },
            { "Browse\u2026", "Procurar\u2026" },
            { "STATUS", "STATUS" },
            { "WHAT YOU GET", "O QUE VOC\u00ca GANHA" },
            { "Discord theme, chat & member list", "Tema Discord, chat e membros" },
            { "Discover tab with live matches", "Descobrir, com partidas ao vivo" },
            { "Translate, mentions & :emoji:", "Tradu\u00e7\u00e3o, men\u00e7\u00f5es e :emoji:" },
            { "Scout card with ELO & win odds", "Ficha com ELO e chances" },
            { "Challenge card, filters & rematch", "Desafios, filtros e revanche" },
            { "VS screens, stats & replays", "Telas VS, estat\u00edsticas e replays" },
            { "Friends, notes & hover cards", "Amigos, notas e perfis" },
            { "Themes, music, Rich Presence & updates", "Temas, m\u00fasica e Rich Presence" },
            { "Cerberus is backed up and removed. Your settings and match history come along.", "O Cerberus vai para um backup; configura\u00e7\u00f5es e hist\u00f3rico v\u00eam junto." },
            { "Install", "Instalar" },
            { "Open Fightcade", "Abrir Fightcade" },
            { "Uninstall", "Desinstalar" },
            { "Repair", "Reparar" },
            { "Update to {0}", "Atualizar p/ {0}" },
            { "Ready.", "Pronto." },
            { "Fightcade folder not found", "Pasta do Fightcade n\u00e3o encontrada" },
            { "Fightcade is running - close it first", "O Fightcade est\u00e1 aberto - feche-o primeiro" },
            { "Pick your Fightcade folder (the one with Fightcade2.exe in it).", "Escolha a pasta do Fightcade (a que tem o Fightcade2.exe)." },
            { "That doesn't look like a Fightcade folder.\n\nPick the folder that contains Fightcade2.exe and fc2-electron.", "Essa n\u00e3o parece ser uma pasta do Fightcade.\n\nEscolha a pasta que tem o Fightcade2.exe e o fc2-electron." },
            { "Not found \u2014 click Browse", "N\u00e3o encontrada \u2014 clique em Procurar" },
            { "Fightcade wasn't found automatically.", "O Fightcade n\u00e3o foi encontrado automaticamente." },
            { "Click Browse and pick the folder with Fightcade2.exe in it.", "Clique em Procurar e escolha a pasta com o Fightcade2.exe." },
            { "Fightcade found.", "Fightcade encontrado." },
            { "Fightcord {0} is installed \u2014 up to date.", "Fightcord {0} instalado \u2014 atualizado." },
            { "Fightcord {0} is installed \u2014 this setup has {1}.", "Fightcord {0} instalado \u2014 este instalador tem a {1}." },
            { "Fightcord is not installed yet.", "O Fightcord ainda n\u00e3o est\u00e1 instalado." },
            { "Cerberus found \u2014 it will be backed up and removed.", "Cerberus encontrado \u2014 ele ser\u00e1 salvo num backup e removido." },
            { "An older plugin setup was found \u2014 it will be backed up and replaced.", "Uma configura\u00e7\u00e3o de plugins antiga foi encontrada \u2014 ela ser\u00e1 salva num backup e substitu\u00edda." },
            { "Fightcade is open \u2014 it has to be closed to install.", "O Fightcade est\u00e1 aberto \u2014 ele precisa ser fechado para instalar." },
            { "A match or emulator is still running.\n\nFinish it, close Fightcade (right-click its tray icon \u2192 Quit), then try again.", "Uma partida ou emulador ainda est\u00e1 rodando.\n\nTermine, feche o Fightcade (bot\u00e3o direito no \u00edcone da bandeja \u2192 Sair) e tente de novo." },
            { "Fightcade is open and has to be closed first.\n\nClose it now?", "O Fightcade est\u00e1 aberto e precisa ser fechado antes.\n\nFechar agora?" },
            { "Nothing is lost: see {0}", "Nada foi perdido: veja {0}" },
            { "Backing up the current setup to {0}", "Fazendo backup da configura\u00e7\u00e3o atual em {0}" },
            { "Bringing your settings and match history along", "Trazendo suas configura\u00e7\u00f5es e seu hist\u00f3rico de partidas" },
            { "your sounds", "seus sons" },
            { "Cerberus and the old loader are out (kept in the backup)", "O Cerberus e o loader antigo foram removidos (guardados no backup)" },
            { "The old loader is out (kept in the backup)", "O loader antigo foi removido (guardado no backup)" },
            { "Installing Fightcord {0}", "Instalando o Fightcord {0}" },
            { "The installer is missing its files (payload.zip). Rebuild it with build.ps1.", "O instalador est\u00e1 sem os arquivos (payload.zip). Gere-o de novo com o build.ps1." },
            { "{0} files", "{0} arquivos" },
            { "Done. Open Fightcade - everything is under Settings \u2192 Fightcord and the other blocks.", "Pronto. Abra o Fightcade - est\u00e1 tudo em Configura\u00e7\u00f5es \u2192 Fightcord e nos outros blocos." },
            { "Remove Fightcord from Fightcade?", "Remover o Fightcord do Fightcade?" },
            { "Your previous setup (Cerberus / old plugins) from {0} can be put back. Restore it?", "Sua configura\u00e7\u00e3o anterior (Cerberus / plugins antigos) de {0} pode ser restaurada. Restaurar?" },
            { "Yes = remove and restore   No = just remove", "Sim = remover e restaurar   N\u00e3o = s\u00f3 remover" },
            { "Cancelled.", "Cancelado." },
            { "Keeping your settings and match history in {0}", "Guardando suas configura\u00e7\u00f5es e seu hist\u00f3rico de partidas em {0}" },
            { "Removing Fightcord", "Removendo o Fightcord" },
            { "Restoring {0}", "Restaurando {0}" },
            { "Fightcord removed.", "Fightcord removido." },
            { "Your previous setup is back.", "Sua configura\u00e7\u00e3o anterior voltou." },
            { "Fightcade runs plain.", "O Fightcade roda normal." },
            { "Restored the emulator's {0}", "O {0} do emulador foi restaurado" }
        };
        static readonly Dictionary<string, string> Es = new Dictionary<string, string>
        {
            { "Fightcord Setup", "Instalaci\u00f3n de Fightcord" },
            { "The Discord-style suite for Fightcade", "El paquete estilo Discord para Fightcade" },
            { "Newest version on GitHub", "Versi\u00f3n m\u00e1s nueva en GitHub" },
            { "Set up Fightcord", "Instalar Fightcord" },
            { "Discord-style chat, a new search tab, stats and more \u2014 in one click.", "Chat estilo Discord, una nueva pesta\u00f1a de b\u00fasqueda, estad\u00edsticas y m\u00e1s \u2014 en un clic." },
            { "FIGHTCADE FOLDER", "CARPETA DE FIGHTCADE" },
            { "Browse\u2026", "Buscar\u2026" },
            { "STATUS", "ESTADO" },
            { "WHAT YOU GET", "QU\u00c9 OBTIENES" },
            { "Discord theme, chat & member list", "Tema Discord, chat y miembros" },
            { "Discover tab with live matches", "Descubrir, con partidas en vivo" },
            { "Translate, mentions & :emoji:", "Traducci\u00f3n, menciones y :emoji:" },
            { "Scout card with ELO & win odds", "Ficha del rival con ELO" },
            { "Challenge card, filters & rematch", "Desaf\u00edos, filtros y revancha" },
            { "VS screens, stats & replays", "Pantallas VS y estad\u00edsticas" },
            { "Friends, notes & hover cards", "Amigos, notas y perfiles" },
            { "Themes, music, Rich Presence & updates", "Temas, m\u00fasica y Rich Presence" },
            { "Cerberus is backed up and removed. Your settings and match history come along.", "Cerberus pasa a un respaldo; tu configuraci\u00f3n e historial se mantienen." },
            { "Install", "Instalar" },
            { "Open Fightcade", "Abrir Fightcade" },
            { "Uninstall", "Desinstalar" },
            { "Repair", "Reparar" },
            { "Update to {0}", "Actualizar a {0}" },
            { "Ready.", "Listo." },
            { "Fightcade folder not found", "No se encontr\u00f3 la carpeta de Fightcade" },
            { "Fightcade is running - close it first", "Fightcade est\u00e1 abierto - ci\u00e9rralo primero" },
            { "Pick your Fightcade folder (the one with Fightcade2.exe in it).", "Elige tu carpeta de Fightcade (la que tiene Fightcade2.exe)." },
            { "That doesn't look like a Fightcade folder.\n\nPick the folder that contains Fightcade2.exe and fc2-electron.", "Esa no parece una carpeta de Fightcade.\n\nElige la carpeta que contiene Fightcade2.exe y fc2-electron." },
            { "Not found \u2014 click Browse", "No encontrada \u2014 haz clic en Buscar" },
            { "Fightcade wasn't found automatically.", "No se encontr\u00f3 Fightcade autom\u00e1ticamente." },
            { "Click Browse and pick the folder with Fightcade2.exe in it.", "Haz clic en Buscar y elige la carpeta con Fightcade2.exe." },
            { "Fightcade found.", "Fightcade encontrado." },
            { "Fightcord {0} is installed \u2014 up to date.", "Fightcord {0} instalado \u2014 al d\u00eda." },
            { "Fightcord {0} is installed \u2014 this setup has {1}.", "Fightcord {0} instalado \u2014 este instalador trae la {1}." },
            { "Fightcord is not installed yet.", "Fightcord todav\u00eda no est\u00e1 instalado." },
            { "Cerberus found \u2014 it will be backed up and removed.", "Se encontr\u00f3 Cerberus \u2014 se respaldar\u00e1 y se quitar\u00e1." },
            { "An older plugin setup was found \u2014 it will be backed up and replaced.", "Se encontr\u00f3 una configuraci\u00f3n de plugins antigua \u2014 se respaldar\u00e1 y se reemplazar\u00e1." },
            { "Fightcade is open \u2014 it has to be closed to install.", "Fightcade est\u00e1 abierto \u2014 hay que cerrarlo para instalar." },
            { "A match or emulator is still running.\n\nFinish it, close Fightcade (right-click its tray icon \u2192 Quit), then try again.", "Todav\u00eda hay una partida o emulador abierto.\n\nTerm\u00ednala, cierra Fightcade (clic derecho en su \u00edcono de la bandeja \u2192 Salir) y vuelve a intentar." },
            { "Fightcade is open and has to be closed first.\n\nClose it now?", "Fightcade est\u00e1 abierto y hay que cerrarlo primero.\n\n\u00bfCerrarlo ahora?" },
            { "Nothing is lost: see {0}", "No se perdi\u00f3 nada: mira {0}" },
            { "Backing up the current setup to {0}", "Respaldando la configuraci\u00f3n actual en {0}" },
            { "Bringing your settings and match history along", "Trayendo tu configuraci\u00f3n y tu historial de partidas" },
            { "your sounds", "tus sonidos" },
            { "Cerberus and the old loader are out (kept in the backup)", "Cerberus y el loader antiguo se quitaron (guardados en el respaldo)" },
            { "The old loader is out (kept in the backup)", "El loader antiguo se quit\u00f3 (guardado en el respaldo)" },
            { "Installing Fightcord {0}", "Instalando Fightcord {0}" },
            { "The installer is missing its files (payload.zip). Rebuild it with build.ps1.", "Al instalador le faltan sus archivos (payload.zip). Vuelve a generarlo con build.ps1." },
            { "{0} files", "{0} archivos" },
            { "Done. Open Fightcade - everything is under Settings \u2192 Fightcord and the other blocks.", "Listo. Abre Fightcade - todo est\u00e1 en Configuraci\u00f3n \u2192 Fightcord y en los otros bloques." },
            { "Remove Fightcord from Fightcade?", "\u00bfQuitar Fightcord de Fightcade?" },
            { "Your previous setup (Cerberus / old plugins) from {0} can be put back. Restore it?", "Tu configuraci\u00f3n anterior (Cerberus / plugins antiguos) de {0} se puede restaurar. \u00bfRestaurarla?" },
            { "Yes = remove and restore   No = just remove", "S\u00ed = quitar y restaurar   No = solo quitar" },
            { "Cancelled.", "Cancelado." },
            { "Keeping your settings and match history in {0}", "Guardando tu configuraci\u00f3n y tu historial de partidas en {0}" },
            { "Removing Fightcord", "Quitando Fightcord" },
            { "Restoring {0}", "Restaurando {0}" },
            { "Fightcord removed.", "Fightcord quitado." },
            { "Your previous setup is back.", "Tu configuraci\u00f3n anterior volvi\u00f3." },
            { "Fightcade runs plain.", "Fightcade funciona normal." },
            { "Restored the emulator's {0}", "Se restaur\u00f3 el {0} del emulador" }
        };
    }
    // ---- end i18n tables ----
}
