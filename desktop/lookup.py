# -*- coding: utf-8 -*-
"""
划词查词 —— 在任何程序里（Word / PDF / Zotero …）拖选一个词，就弹出 Timetracker 的查词窗。

为什么是这么实现的：
  Windows 没有「跨程序的选中事件」。所有划词工具（欧路、GoldenDict）用的都是同一招 ——
  盯着鼠标，发现「按下 → 拖动 → 松开」，就替你按一下 Ctrl+C，读剪贴板。
  所以热键其实还在，只是从你手上挪到了程序手上。

  查词结果不自己画：直接开一个小窗指向网站的 ?w=…&add=1&mini=1。
  那是同一个源，所以生词进的是同一个生词本、跟着同一套云同步上手机 —— 一行同步代码都不用写。

两个刻意的选择：
  1) **不挂系统钩子，改成 25 毫秒轮询。** 低级鼠标钩子写坏了会把整个系统的输入拖慢，
     而轮询最坏也就是自己这个进程卡住。代价是偶尔慢一两帧，肉眼看不出来。
  2) **终端一律不划词。** Ctrl+C 在 PowerShell / cmd 里是「中断正在跑的程序」——
     拖选一段输出就可能掐掉一个跑了半小时的脚本。这是唯一会**破坏你正在做的事**的坑，
     所以默认拦住，而且拦的是「前台窗口属于哪个程序」，不是窗口标题。

  用法：pythonw desktop\\lookup.py        （pythonw = 没有黑窗口）
  停止：任务管理器里结束 pythonw.exe，或者按 Ctrl+Alt+Q
"""
import os, sys, time, subprocess, urllib.parse, configparser

import win32api, win32con, win32gui, win32process, win32clipboard

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = os.path.join(HERE, "lookup.log")

CFG = {
    "site": "https://kathychen47.github.io/timetracker/",
    "chrome": "",                 # 留空 = 自己找
    "enabled": True,              # 划词开关
    "words_only": True,           # True = 只有拖出「一个单词」才自动弹；整句用热键
    "win_w": 460, "win_h": 620,
    "hot_lookup": "ctrl+alt+d",   # 手动查一下（整句翻译用它）
    "hot_toggle": "ctrl+alt+s",   # 暂停 / 恢复划词
    "hot_quit": "ctrl+alt+q",
    "blacklist": ["windowsterminal.exe", "cmd.exe", "powershell.exe", "pwsh.exe",
                  "conhost.exe", "openconsole.exe", "code.exe", "putty.exe", "mintty.exe"],
}


def log(msg):
    try:
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(time.strftime("%H:%M:%S ") + str(msg) + "\n")
    except Exception:
        pass


def load_cfg():
    p = os.path.join(HERE, "设置.ini")
    if not os.path.exists(p):
        return
    c = configparser.ConfigParser()
    try:
        c.read(p, encoding="utf-8")
    except Exception as e:
        log("设置.ini 读不了：%s" % e); return
    g = lambda s, k, d: c.get(s, k, fallback=d)
    CFG["enabled"] = g("划词", "开启", "1").strip() not in ("0", "否", "false", "False")
    CFG["words_only"] = g("划词", "只查单词", "1").strip() not in ("0", "否", "false", "False")
    CFG["site"] = g("网站", "地址", CFG["site"]).strip() or CFG["site"]
    CFG["chrome"] = g("网站", "chrome", "").strip()
    try:
        CFG["win_w"] = int(g("窗口", "宽", CFG["win_w"]))
        CFG["win_h"] = int(g("窗口", "高", CFG["win_h"]))
    except Exception:
        pass
    CFG["hot_lookup"] = g("快捷键", "查词", CFG["hot_lookup"]).strip().lower()
    CFG["hot_toggle"] = g("快捷键", "开关划词", CFG["hot_toggle"]).strip().lower()
    CFG["hot_quit"] = g("快捷键", "退出", CFG["hot_quit"]).strip().lower()
    bl = g("不划词的程序", "黑名单", "")
    if bl.strip():
        CFG["blacklist"] = [x.strip().lower() for x in bl.replace("，", ",").split(",") if x.strip()]


def find_chrome():
    if CFG["chrome"] and os.path.exists(CFG["chrome"]):
        return CFG["chrome"]
    for p in (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
              r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
              os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
              r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"):
        if os.path.exists(p):
            return p
    return ""


# ---------- 前台窗口是谁 ----------
def fg_exe():
    """前台窗口属于哪个程序。拿不到就返回空 —— 拿不到时宁可放行，别把功能整个废掉。"""
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        h = win32api.OpenProcess(win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, False, pid)
        try:
            return os.path.basename(win32process.GetModuleFileNameEx(h, 0)).lower()
        finally:
            win32api.CloseHandle(h)
    except Exception:
        return ""


# ---------- 剪贴板 ----------
def clip_text():
    for _ in range(6):
        try:
            win32clipboard.OpenClipboard()
            try:
                if win32clipboard.IsClipboardFormatAvailable(win32con.CF_UNICODETEXT):
                    return win32clipboard.GetClipboardData(win32con.CF_UNICODETEXT)
                return None
            finally:
                win32clipboard.CloseClipboard()
        except Exception:
            time.sleep(0.03)
    return None


def clip_set(text):
    for _ in range(6):
        try:
            win32clipboard.OpenClipboard()
            try:
                win32clipboard.EmptyClipboard()
                if text:
                    win32clipboard.SetClipboardData(win32con.CF_UNICODETEXT, text)
                return True
            finally:
                win32clipboard.CloseClipboard()
        except Exception:
            time.sleep(0.03)
    return False


def clip_seq():
    try:
        return win32clipboard.GetClipboardSequenceNumber()
    except Exception:
        return 0


def send_copy():
    win32api.keybd_event(win32con.VK_CONTROL, 0, 0, 0)
    win32api.keybd_event(ord("C"), 0, 0, 0)
    win32api.keybd_event(ord("C"), 0, win32con.KEYEVENTF_KEYUP, 0)
    win32api.keybd_event(win32con.VK_CONTROL, 0, win32con.KEYEVENTF_KEYUP, 0)


def grab_selection():
    """替她按一下 Ctrl+C，把选中的文字拿回来，然后把剪贴板原样还回去。
    还回去的只有文字 —— 原来剪贴板里要是一张图或一个文件，这次会丢。已知代价。"""
    before = clip_text()
    seq0 = clip_seq()
    send_copy()
    got = None
    for _ in range(24):                       # 最多等 600ms
        time.sleep(0.025)
        if clip_seq() != seq0:
            got = clip_text()
            break
    clip_set(before)                          # 不管成没成，都把原来的还回去
    return got


# ---------- 查词窗 ----------
_popup = [0]        # 上一个查词窗的 hwnd


def chrome_windows():
    out = set()
    def cb(h, _):
        try:
            if not win32gui.IsWindowVisible(h):
                return
            _, pid = win32process.GetWindowThreadProcessId(h)
            hp = win32api.OpenProcess(win32con.PROCESS_QUERY_INFORMATION | win32con.PROCESS_VM_READ, False, pid)
            try:
                exe = os.path.basename(win32process.GetModuleFileNameEx(hp, 0)).lower()
            finally:
                win32api.CloseHandle(hp)
            if exe in ("chrome.exe", "msedge.exe"):
                out.add(h)
        except Exception:
            pass
    try:
        win32gui.EnumWindows(cb, None)
    except Exception:
        pass
    return out


def force_focus(hwnd):
    """把焦点还给她刚才那个窗口。
    SetForegroundWindow 有一堆限制（不是前台进程就会被拒），
    先假装按一下 Alt 是业界通用的解锁办法。"""
    if not hwnd or not win32gui.IsWindow(hwnd):
        return False
    try:
        win32api.keybd_event(win32con.VK_MENU, 0, 0, 0)
        win32api.keybd_event(win32con.VK_MENU, 0, win32con.KEYEVENTF_KEYUP, 0)
        win32gui.SetForegroundWindow(hwnd)
        return True
    except Exception as e:
        log("还焦点失败：%s" % e)
        return False


def popup(word):
    chrome = find_chrome()
    if not chrome:
        log("找不到 chrome.exe"); return
    prev = win32gui.GetForegroundWindow()
    # 关掉上一个查词窗（关之前确认它还是个窗口，别误关别的）
    if _popup[0] and win32gui.IsWindow(_popup[0]):
        try:
            win32gui.PostMessage(_popup[0], win32con.WM_CLOSE, 0, 0)
        except Exception:
            pass
        _popup[0] = 0
    before = chrome_windows()
    url = (CFG["site"].rstrip("/") + "/?w=" + urllib.parse.quote(word) + "&add=1&mini=1")
    try:
        subprocess.Popen([chrome, "--app=" + url,
                          "--window-size=%d,%d" % (CFG["win_w"], CFG["win_h"])],
                         close_fds=True)
    except Exception as e:
        log("开窗失败：%s" % e); return
    # 等新窗口出来，置顶，然后把焦点还回去
    hwnd = 0
    t0 = time.time()
    while time.time() - t0 < 3.0:
        time.sleep(0.05)
        new = chrome_windows() - before
        if new:
            hwnd = max(new)
            break
    if hwnd:
        _popup[0] = hwnd
        # 置顶要重试：窗口刚建出来的那一瞬间样式还没定下来，
        # 实测有时候第一次就成，有时候要等一两百毫秒 —— 不重试就会随机地不置顶。
        for delay in (0, .12, .25, .4):
            time.sleep(delay)
            try:
                win32gui.SetWindowPos(hwnd, win32con.HWND_TOPMOST, 0, 0, 0, 0,
                                      win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE)
                if win32api.GetWindowLong(hwnd, win32con.GWL_EXSTYLE) & win32con.WS_EX_TOPMOST:
                    break
            except Exception:
                pass
    else:
        time.sleep(0.12)
    force_focus(prev)
    log("查「%s」 用时 %.2fs  窗口=%s" % (word, time.time() - t0, hwnd))


# ---------- 什么算「一个词」 ----------
def clean(sel):
    if not sel:
        return ""
    s = " ".join(sel.split())            # 换行、连续空格压成一个空格
    return s.strip(" \t\r\n\u3000")


def is_word(s):
    if not s:
        return False
    if any("\u4e00" <= ch <= "\u9fff" for ch in s):
        return len(s) <= 4               # 中文：4 个字以内算一个词
    return len(s.split()) == 1 and len(s) <= 32


# ---------- 热键（跟鼠标一起轮询，不注册系统热键：注册会跟别的程序抢） ----------
VK = {"ctrl": win32con.VK_CONTROL, "alt": win32con.VK_MENU, "shift": win32con.VK_SHIFT,
      "win": win32con.VK_LWIN}


def parse_hot(spec):
    keys = [k.strip() for k in spec.split("+") if k.strip()]
    mods = [VK[k] for k in keys if k in VK]
    main = [k for k in keys if k not in VK]
    if not main:
        return None
    ch = main[-1]
    vk = ord(ch.upper()) if len(ch) == 1 else None
    return (mods, vk) if vk else None


def hot_down(hot):
    if not hot:
        return False
    mods, vk = hot
    for m in mods:
        if not (win32api.GetAsyncKeyState(m) & 0x8000):
            return False
    return bool(win32api.GetAsyncKeyState(vk) & 0x8000)


def main():
    load_cfg()
    log("=== 起来了 ===  划词=%s  只查单词=%s  站点=%s" % (CFG["enabled"], CFG["words_only"], CFG["site"]))
    hot_look = parse_hot(CFG["hot_lookup"])
    hot_tog = parse_hot(CFG["hot_toggle"])
    hot_quit = parse_hot(CFG["hot_quit"])

    on = CFG["enabled"]
    down_at = None          # 左键按下时的 (x, y, t)
    prev_down = False
    hot_prev = {"look": False, "tog": False, "quit": False}

    while True:
        time.sleep(0.025)

        # --- 热键 ---
        d = hot_down(hot_quit)
        if d and not hot_prev["quit"]:
            log("退出"); return
        hot_prev["quit"] = d

        d = hot_down(hot_tog)
        if d and not hot_prev["tog"]:
            on = not on
            log("划词 -> %s" % ("开" if on else "关"))
        hot_prev["tog"] = d

        d = hot_down(hot_look)
        if d and not hot_prev["look"]:
            sel = clean(grab_selection())
            if sel and len(sel) <= 200:
                popup(sel)
        hot_prev["look"] = d

        # --- 鼠标划词 ---
        if not on:
            prev_down = False
            continue
        now_down = bool(win32api.GetAsyncKeyState(win32con.VK_LBUTTON) & 0x8000)
        if now_down and not prev_down:
            try:
                x, y = win32api.GetCursorPos()
            except Exception:
                x = y = 0
            down_at = (x, y, time.time())
        elif prev_down and not now_down and down_at:
            try:
                x, y = win32api.GetCursorPos()
            except Exception:
                x = y = 0
            dx, dy = abs(x - down_at[0]), abs(y - down_at[1])
            dur = time.time() - down_at[2]
            down_at = None
            # 拖过一小段、时间不太长 = 像在选字；顺手拖个文件、点一下都不算
            if (dx + dy) >= 6 and dur <= 5.0:
                exe = fg_exe()
                if exe in CFG["blacklist"]:
                    log("跳过（黑名单）：%s" % exe)
                else:
                    sel = clean(grab_selection())
                    if sel and len(sel) <= 200 and (is_word(sel) or not CFG["words_only"]):
                        popup(sel)
        prev_down = now_down


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as e:
        log("崩了：%r" % e)
        raise
