#!/usr/bin/env python3
"""
Real-browser Playwright runner for combined Path A + Path B + Path D E2E verification.
Invoked by tests/test-demo-path-abd-e2e.ts (which manages DB baseline checks, snapshot/restore, and cache invalidation).
"""

import json
import os
import re
import sys
import time
import traceback
from pathlib import Path
from playwright.sync_api import sync_playwright, expect, Page, Dialog


BASE_URL = os.environ.get("E2E_BASE_URL", "http://localhost:3000").rstrip("/")
RESULT_JSON_PATH = os.environ.get("E2E_RESULT_JSON", "/tmp/demo-abd-e2e-result.json")
CITIZEN_USERNAME = os.environ.get("CITIZEN_USERNAME", "citizen")
CITIZEN_PASSWORD = os.environ.get("CITIZEN_PASSWORD", "citizen123")
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin")

HEADLESS_SHELL_CANDIDATE = Path(
    os.path.expanduser(
        "~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell"
    )
)


class StepTracker:
    def __init__(self) -> None:
        self.passed: list[str] = []
        self.failed: list[str] = []
        self.page_errors: list[str] = []
        self.console_errors: list[str] = []
        self.same_origin_http_errors: list[str] = []
        self.same_origin_request_failures: list[str] = []
        self.external_tile_errors: list[str] = []
        self.external_tile_ok = 0
        self.geocode_requests_in_ecom = 0
        self.track_ecom_geocode = False

        self.created_ticket_id = ""
        self.created_ticket_no = ""
        self.created_task_ids: list[str] = []
        self.created_report_ids: list[str] = []
        self.reopened_theme_id = ""
        self.reopened_task_id = ""
        self.reopened_ticket_id = ""

    def ok(self, msg: str) -> None:
        self.passed.append(msg)
        print(f"PASS [Browser] {msg}", flush=True)

    def fail(self, msg: str) -> None:
        self.failed.append(msg)
        print(f"FAIL [Browser] {msg}", file=sys.stderr, flush=True)

    def check(self, cond: bool, msg: str) -> None:
        if cond:
            self.ok(msg)
        else:
            self.fail(msg)
            raise AssertionError(msg)

    def attach(self, page: Page, label: str) -> None:
        def on_pageerror(err) -> None:
            text = str(err)
            if "xiaochun.firetable.tech" in text:
                print(f"INFO [{label}] ignored external xiaochun pageerror: {text}", flush=True)
                return
            self.page_errors.append(f"[{label}] {text}")
            print(f"ERR_PAGE [{label}] {text}", file=sys.stderr, flush=True)

        def on_console(msg) -> None:
            if msg.type != "error":
                return
            loc = ""
            try:
                loc = str(msg.location.get("url", "")) if msg.location else ""
            except Exception:
                loc = ""
            text = msg.text or ""
            if "xiaochun.firetable.tech" in loc or "xiaochun.firetable.tech" in text:
                print(f"INFO [{label}] ignored external xiaochun console.error: {text}", flush=True)
                return
            if "tianditu.gov.cn" in loc or "tianditu.gov.cn" in text:
                self.external_tile_errors.append(f"[{label}] console: {text} ({loc})")
                return
            # Ignore browser-reported net::ERR_* solely on third-party origins when loc is non-localhost
            if loc and not loc.startswith(BASE_URL) and loc.startswith("http") and "net::ERR_" in text:
                print(f"INFO [{label}] ignored third-party net::ERR console.error ({loc}): {text}", flush=True)
                return
            self.console_errors.append(f"[{label}] {text} ({loc})")
            print(f"ERR_CONSOLE [{label}] {text} ({loc})", file=sys.stderr, flush=True)

        def on_request(req) -> None:
            if self.track_ecom_geocode and "/api/map/geocode" in req.url:
                self.geocode_requests_in_ecom += 1

        def on_requestfailed(req) -> None:
            url = str(req.url or "")
            failure = str(req.failure or "")
            if "tianditu.gov.cn" in url:
                if "net::ERR_ABORTED" not in failure:
                    self.external_tile_errors.append(f"[{label}] requestfailed: {failure} {url}")
                return
            if "xiaochun.firetable.tech" in url:
                print(f"INFO [{label}] ignored external xiaochun requestfailed ({failure}): {url}", flush=True)
                return
            if url.startswith(BASE_URL):
                if "net::ERR_ABORTED" in failure:
                    return
                self.same_origin_request_failures.append(f"[{label}] {req.method} {url} -> {failure}")
                print(f"ERR_REQ_FAILED [{label}] {req.method} {url} -> {failure}", file=sys.stderr, flush=True)

        def on_response(res) -> None:
            url = res.url
            status = res.status
            if "tianditu.gov.cn" in url:
                if status >= 400:
                    self.external_tile_errors.append(f"[{label}] {status} {url}")
                else:
                    self.external_tile_ok += 1
                return
            if url.startswith(BASE_URL) and status >= 400:
                self.same_origin_http_errors.append(f"[{label}] {status} {res.request.method} {url}")
                print(f"ERR_HTTP [{label}] {status} {res.request.method} {url}", file=sys.stderr, flush=True)

        page.on("pageerror", on_pageerror)
        page.on("console", on_console)
        page.on("request", on_request)
        page.on("requestfailed", on_requestfailed)
        page.on("response", on_response)


def login_ui(page: Page, username: str, password: str, expected_path_prefix: str) -> None:
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded", timeout=30000)
    acc = page.locator("#account")
    pwd = page.locator("#password")
    expect(acc).to_be_visible(timeout=15000)
    expect(pwd).to_be_visible(timeout=15000)
    if username == "citizen" and password == "citizen123":
        quick_btn = page.locator('button:has-text("普通市民投诉端"), button:has-text("普通买家投诉端")').first
        expect(quick_btn).to_be_visible(timeout=15000)
        deadline = time.time() + 15.0
        while time.time() < deadline:
            quick_btn.click()
            if acc.input_value() == username and pwd.input_value() == password:
                break
            time.sleep(0.25)
    elif username == "admin" and password == "admin":
        # Toggle via citizen quick-fill first so React state transition confirms hydration
        citizen_btn = page.locator('button:has-text("普通市民投诉端"), button:has-text("普通买家投诉端")').first
        admin_btn = page.locator('button:has-text("管理员工作台")').first
        expect(admin_btn).to_be_visible(timeout=15000)
        deadline = time.time() + 15.0
        hydrated = False
        while time.time() < deadline:
            citizen_btn.click()
            if acc.input_value() == "citizen":
                hydrated = True
                break
            time.sleep(0.25)
        if not hydrated:
            raise AssertionError("login_ui timed out waiting for /login React hydration")
        admin_btn.click()
    else:
        hydrated_fill(acc, username)
        hydrated_fill(pwd, password)
    expect(acc).to_have_value(username, timeout=5000)
    expect(pwd).to_have_value(password, timeout=5000)
    page.get_by_role("button", name="安全登录进入系统").click()
    if expected_path_prefix == "/":
        page.wait_for_url(re.compile(rf"^{re.escape(BASE_URL)}/(?!login)"), wait_until="commit", timeout=60000)
        page.wait_for_load_state("domcontentloaded", timeout=30000)
        expect(page.locator("main")).to_be_visible(timeout=45000)
        expect(page.locator("button.chat-fab")).to_be_visible(timeout=45000)
    else:
        page.wait_for_url(re.compile(rf"^{re.escape(BASE_URL)}{re.escape(expected_path_prefix)}"), wait_until="commit", timeout=60000)
        page.wait_for_load_state("domcontentloaded", timeout=30000)
        if expected_path_prefix == "/submit":
            expect(page.locator("#voice-chat-input")).to_be_visible(timeout=45000)
            expect(page.locator("[data-xiaochun-stage-status]").first).to_be_visible(timeout=45000)
        else:
            expect(page.locator("main")).to_be_visible(timeout=45000)


def hydrated_fill(input_loc, text: str, submit_btn_loc=None, timeout_s: float = 15.0) -> None:
    expect(input_loc).to_be_visible(timeout=int(timeout_s * 1000))
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        input_loc.fill(text)
        if input_loc.input_value() == text:
            if submit_btn_loc is None or submit_btn_loc.is_enabled():
                return
        time.sleep(0.25)
    raise AssertionError(f"hydrated_fill timed out waiting for input/button readiness for text={text[:24]!r}")


def assert_no_runtime_errors(tracker: StepTracker, stage: str) -> None:
    tracker.check(
        len(tracker.page_errors) == 0,
        f"[{stage}] zero pageerrors (got {len(tracker.page_errors)}: {tracker.page_errors[:2]})",
    )
    tracker.check(
        len(tracker.console_errors) == 0,
        f"[{stage}] zero app console.errors (got {len(tracker.console_errors)}: {tracker.console_errors[:2]})",
    )
    tracker.check(
        len(tracker.same_origin_http_errors) == 0,
        f"[{stage}] zero same-origin HTTP >= 400 (got {len(tracker.same_origin_http_errors)}: {tracker.same_origin_http_errors[:2]})",
    )
    tracker.check(
        len(tracker.same_origin_request_failures) == 0,
        f"[{stage}] zero same-origin non-abort requestfailed (got {len(tracker.same_origin_request_failures)}: {tracker.same_origin_request_failures[:2]})",
    )
    tracker.check(
        len(tracker.external_tile_errors) == 0 and tracker.external_tile_ok > 0,
        f"[{stage}] Tianditu tiles loaded cleanly with zero errors (ok={tracker.external_tile_ok}, errors={tracker.external_tile_errors[:2]})",
    )


def run() -> int:
    tracker = StepTracker()
    temp_files: list[str] = []
    exit_code = 0
    citizen_page: Page | None = None
    admin_page: Page | None = None

    try:
        with sync_playwright() as p:
            launch_kwargs: dict = {
                "headless": True,
                "args": [
                    "--use-gl=angle",
                    "--use-angle=swiftshader",
                    "--enable-webgl",
                    "--ignore-gpu-blocklist",
                ],
            }
            if HEADLESS_SHELL_CANDIDATE.exists():
                launch_kwargs["executable_path"] = str(HEADLESS_SHELL_CANDIDATE)

            browser = p.chromium.launch(**launch_kwargs)
            citizen_ctx = browser.new_context(
                viewport={"width": 1440, "height": 900},
                accept_downloads=True,
                reduced_motion="reduce",
            )
            admin_ctx = browser.new_context(
                viewport={"width": 1440, "height": 900},
                accept_downloads=True,
                reduced_motion="reduce",
            )

            citizen_page = citizen_ctx.new_page()
            admin_page = admin_ctx.new_page()
            tracker.attach(citizen_page, "citizen")
            tracker.attach(admin_page, "admin")

            # -----------------------------------------------------------------
            # Login both sessions
            # -----------------------------------------------------------------
            login_ui(citizen_page, CITIZEN_USERNAME, CITIZEN_PASSWORD, "/submit")
            tracker.ok("Citizen login redirected to /submit")

            login_ui(admin_page, ADMIN_USERNAME, ADMIN_PASSWORD, "/")
            tracker.ok("Admin login redirected to /")

            # Ensure admin starts on gz_tianhe
            admin_page.evaluate(
                """() => {
                    localStorage.setItem('civic_active_region', 'gz_tianhe');
                    document.cookie = 'active_region=gz_tianhe; path=/; max-age=31536000; SameSite=Lax';
                }"""
            )
            citizen_page.evaluate(
                """() => {
                    localStorage.setItem('civic_active_region', 'gz_tianhe');
                    document.cookie = 'active_region=gz_tianhe; path=/; max-age=31536000; SameSite=Lax';
                }"""
            )

            # =================================================================
            # PATH A (R1): Citizen /submit -> Admin /tickets -> /agent -> /tickets/[id] -> Copilot & MD Export
            # =================================================================
            citizen_page.goto(f"{BASE_URL}/submit", wait_until="domcontentloaded", timeout=30000)
            stage_locator = citizen_page.locator("[data-xiaochun-stage-status]").first
            expect(stage_locator).to_be_visible(timeout=20000)
            stage_status = stage_locator.get_attribute("data-xiaochun-stage-status")
            tracker.check(
                stage_status in ("standby", "loading", "ready", "fallback"),
                f"Path A.1a XiaochunStage mounted on /submit (status={stage_status})",
            )

            # Turn 1: Missing contact & street/shop info -> Agent asks follow-up
            msg_input = citizen_page.locator("#voice-chat-input")
            send_btn = citizen_page.locator('button.voice-send-btn[type="submit"]')
            expect(msg_input).to_be_visible(timeout=15000)
            expect(citizen_page.locator(".voice-msg--assistant").first).to_be_visible(timeout=15000)
            before_assist = citizen_page.locator(".voice-msg--assistant").count()
            turn1_text = "石牌街道附近晚上烧烤油烟和噪声特别大，严重影响居民休息"
            hydrated_fill(msg_input, turn1_text, send_btn)
            with citizen_page.expect_response(
                lambda r: "/api/intake/chat" in r.url and r.request.method == "POST",
                timeout=90000,
            ) as chat1_res_info:
                send_btn.click()
            chat1_res = chat1_res_info.value
            chat1_json = chat1_res.json()
            tracker.check(
                chat1_res.status == 200
                and chat1_json.get("success") is True
                and chat1_json.get("readyToSubmit") is False
                and len(chat1_json.get("missingFields") or []) > 0,
                f"Path A.1b Turn 1 multi-turn follow-up triggered (missing={chat1_json.get('missingFields')})",
            )
            expect(citizen_page.locator(".voice-msg--assistant")).to_have_count(before_assist + 1, timeout=15000)
            expect(citizen_page.locator("#voice-draft-status")).to_contain_text("还需补充", timeout=10000)

            # Turn 2: Spoken/segmented +86 phone + email (still intentionally omit explicit street address/shop so Step 4 surfaces MISSING_INFO!)
            turn2_text = "我的电话是+86一五九，七六六七，三三六三，邮箱 test@example.com"
            hydrated_fill(msg_input, turn2_text, send_btn)
            with citizen_page.expect_response(
                lambda r: "/api/intake/chat" in r.url and r.request.method == "POST",
                timeout=90000,
            ) as chat2_res_info:
                send_btn.click()
            chat2_res = chat2_res_info.value
            chat2_json = chat2_res.json()
            tracker.check(
                chat2_res.status == 200 and chat2_json.get("success") is True,
                "Path A.1c Turn 2 spoken/segmented phone & email processed",
            )
            expect(citizen_page.locator(".voice-msg--assistant")).to_have_count(before_assist + 2, timeout=15000)
            expect(citizen_page.locator("#draft-phone-input")).to_have_value("15976673363", timeout=10000)
            expect(citizen_page.locator("#draft-email-input")).to_have_value("test@example.com", timeout=10000)

            # Verify address & subject stay empty (or note if LLM didn't populate them)
            draft_addr = citizen_page.locator("#draft-address-input").input_value().strip()
            draft_subj = citizen_page.locator("#draft-subject-input").input_value().strip()
            if draft_addr or draft_subj:
                # Clear only if LLM inferred generic/extra placeholder so MISSING_INFO patrol tests missing-info follow-up genuinely
                if draft_addr:
                    citizen_page.locator("#draft-address-input").fill("")
                if draft_subj:
                    citizen_page.locator("#draft-subject-input").fill("")

            # Include inline phone/email in #draft-content-textarea so anonymize() PII masking is genuinely exercised & verified
            draft_content_loc = citizen_page.locator("#draft-content-textarea")
            cur_draft_content = draft_content_loc.input_value().strip()
            hydrated_fill(
                draft_content_loc,
                f"{cur_draft_content}，夜间联系电话 15976673363，邮箱 test@example.com",
            )

            submit_btn = citizen_page.locator('button:has-text("一键确认提交投诉")')
            expect(submit_btn).to_be_enabled(timeout=15000)

            with citizen_page.expect_response(
                lambda r: "/api/intake/submit" in r.url and r.request.method == "POST",
                timeout=30000,
            ) as sub_res_info:
                submit_btn.click()
            sub_res = sub_res_info.value
            sub_json = sub_res.json()
            tracker.created_ticket_id = str(sub_json.get("ticketId") or "")
            tracker.created_ticket_no = str(sub_json.get("ticketNo") or "")
            masked_preview = str(sub_json.get("maskedPreview") or "")
            tracker.check(
                sub_res.status == 200
                and sub_json.get("success") is True
                and bool(tracker.created_ticket_id)
                and bool(tracker.created_ticket_no)
                and "{{PHONE_NUMBER_" in masked_preview
                and "{{EMAIL_" in masked_preview
                and "15976673363" not in masked_preview
                and "test@example.com" not in masked_preview,
                f"Path A.1d Submit succeeded with anonymize() PII masking tokens ({tracker.created_ticket_no})",
            )

            receipt = citizen_page.locator('section[aria-label="受理回执"]')
            expect(receipt).to_be_visible(timeout=15000)
            expect(receipt).to_contain_text(tracker.created_ticket_no)
            receipt_text = receipt.inner_text()
            tracker.check(
                "{{PHONE_NUMBER_" in receipt_text
                and "{{EMAIL_" in receipt_text
                and "15976673363" not in receipt_text
                and "test@example.com" not in receipt_text,
                "Path A.1e Receipt card renders anonymize() tokens and masks raw phone/email PII",
            )
            # Release citizen WebGL/Xiaochun context now that Path A.1 intake is complete
            citizen_ctx.close()
            citizen_ctx = None

            # Path A.2: Admin sees newly pushed ticket on /tickets
            admin_page.goto(f"{BASE_URL}/tickets", wait_until="domcontentloaded", timeout=45000)
            search_box = admin_page.locator('input[aria-label="搜索工单标题、工单号或内容"]')
            hydrated_fill(search_box, tracker.created_ticket_no, timeout_s=45.0)

            row_loc = admin_page.locator("table.workorder-table tbody tr", has_text=tracker.created_ticket_no).first
            expect(row_loc).to_be_visible(timeout=20000)
            tracker.ok(f"Path A.2 Admin /tickets displays newly pushed ticket {tracker.created_ticket_no}")

            # Path A.3: Poll until background ingest completes (confidence > 0)
            verdict_data = None
            for _ in range(35):
                resp = admin_ctx.request.get(
                    f"{BASE_URL}/api/workorders/{tracker.created_ticket_id}?region=gz_tianhe",
                    headers={"x-region-id": "gz_tianhe"},
                )
                if resp.status == 200:
                    payload = resp.json()
                    conf = payload.get("confidence")
                    if conf is not None and float(conf) > 0:
                        verdict_data = payload
                        break
                time.sleep(1.5)

            tracker.check(
                verdict_data is not None and float(verdict_data.get("confidence") or 0) > 0,
                f"Path A.3 Auto-processing completed (confidence={verdict_data.get('confidence') if verdict_data else None}, subdistrict={verdict_data.get('region') if verdict_data else None})",
            )

            # Open drawer on /tickets to verify AI verdict UI & detail link
            row_loc.locator(f'button[aria-label="查看工单 {tracker.created_ticket_no} 详情"], button:has-text("查看")').first.click()
            drawer = admin_page.locator("dialog.civic-ticket-drawer[open]")
            expect(drawer).to_be_visible(timeout=15000)
            expect(drawer).to_contain_text("AI 智能研判解析", timeout=15000)
            expect(drawer).to_contain_text("置信度", timeout=15000)
            expect(drawer).to_contain_text("市民诉求原文", timeout=15000)
            expect(drawer).to_contain_text("石牌街道", timeout=15000)
            detail_btn = drawer.locator('button:has-text("打开完整详情")')
            expect(detail_btn).to_be_enabled(timeout=10000)
            detail_btn.click()
            admin_page.wait_for_url(
                re.compile(rf"/tickets/{re.escape(tracker.created_ticket_id)}"),
                wait_until="commit",
                timeout=45000,
            )
            expect(admin_page.locator("main")).to_be_visible(timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("石牌街道", timeout=45000)
            expect(admin_page.locator("#ticket-status-note")).to_be_visible(timeout=45000)
            tracker.ok("Path A.3b Ticket drawer & detail page render extracted subdistrict/category")

            # Path A.4: /agent patrol -> MISSING_INFO -> VoiceOutreachDialog completion
            admin_page.goto(f"{BASE_URL}/agent", wait_until="domcontentloaded", timeout=45000)
            patrol_btn = admin_page.locator('button:has-text("立即巡检")')
            expect(patrol_btn).to_be_visible(timeout=45000)
            expect(patrol_btn).to_be_enabled(timeout=45000)
            with admin_page.expect_response(
                lambda r: "/api/agent/patrol" in r.url and r.request.method == "POST",
                timeout=60000,
            ) as patrol_res_info:
                patrol_btn.click()
            patrol_res = patrol_res_info.value
            patrol_json = patrol_res.json()
            tracker.check(patrol_res.status == 200 and patrol_json.get("success") is True, "Path A.4a /agent patrol triggered (200)")
            for t in patrol_json.get("tasks") or []:
                if t.get("id"):
                    tracker.created_task_ids.append(str(t["id"]))

            missing_card = admin_page.locator("article", has_text=tracker.created_ticket_id).filter(has_text="缺失要素补全").first
            expect(missing_card).to_be_visible(timeout=15000)
            missing_card.locator('button:has-text("发起 AI 语音外呼")').click()

            voice_dlg = admin_page.locator("dialog.civic-voice-dialog[open]")
            expect(voice_dlg).to_be_visible(timeout=15000)
            voice_dlg.get_by_label("文字输入应答").fill("具体地址在石牌西路88号楼下老广烧烤档")
            with admin_page.expect_response(
                lambda r: "/api/agent/outreach/voice-turn" in r.url and r.request.method == "POST",
                timeout=60000,
            ) as vt_a_info:
                voice_dlg.locator('button[type="submit"][aria-label="发送文本应答"]').click()
            vt_a = vt_a_info.value
            vt_a_json = vt_a.json()
            tracker.check(
                vt_a.status == 200
                and vt_a_json.get("success") is True
                and bool((vt_a_json.get("extractedPatch") or {}).get("address") or (vt_a_json.get("extractedPatch") or {}).get("canonicalSubject")),
                f"Path A.4b VoiceOutreachDialog completed missing info ({vt_a_json.get('extractedPatch')})",
            )
            expect(voice_dlg).to_contain_text("AI 结构化抽取补全结果（已写回数据库）", timeout=10000)
            confirm_a_btn = voice_dlg.locator('button:has-text("确认完成并刷新队列")')
            expect(confirm_a_btn).to_be_visible(timeout=10000)
            expect(confirm_a_btn).to_be_enabled(timeout=10000)
            confirm_a_btn.scroll_into_view_if_needed()
            confirm_a_btn.click()
            expect(voice_dlg).not_to_be_visible(timeout=15000)
            expect(missing_card).to_contain_text("已执行", timeout=15000)

            # Path A.5: Status transitions PENDING -> IN_PROGRESS -> RESOLVED on /tickets/[id]
            admin_page.goto(f"{BASE_URL}/tickets/{tracker.created_ticket_id}", wait_until="domcontentloaded", timeout=45000)
            status_note = admin_page.locator("#ticket-status-note")
            in_prog_btn = admin_page.locator('button:has-text("处理中")').first
            expect(status_note).to_be_visible(timeout=45000)
            expect(in_prog_btn).to_be_enabled(timeout=45000)

            hydrated_fill(status_note, "E2E 派单核查")
            with admin_page.expect_response(
                lambda r: f"/api/workorders/{tracker.created_ticket_id}" in r.url and r.request.method == "PATCH",
                timeout=30000,
            ) as st1_info:
                in_prog_btn.click()
            tracker.check(st1_info.value.status == 200, "Path A.5a Transitioned ticket to IN_PROGRESS")
            expect(admin_page.locator(".status-tag").first).to_contain_text("处理中", timeout=10000)

            resolve_btn = admin_page.locator('button:has-text("已办结")').first
            expect(resolve_btn).to_be_enabled(timeout=15000)
            hydrated_fill(status_note, "E2E 整改完成办结")
            with admin_page.expect_response(
                lambda r: f"/api/workorders/{tracker.created_ticket_id}" in r.url and r.request.method == "PATCH",
                timeout=30000,
            ) as st2_info:
                resolve_btn.click()
            tracker.check(st2_info.value.status == 200, "Path A.5b Transitioned ticket to RESOLVED")
            expect(admin_page.locator(".status-tag").first).to_contain_text("已办结", timeout=10000)
            expect(admin_page.locator("main")).to_contain_text("处置流转时间轴", timeout=10000)
            expect(admin_page.locator("main")).to_contain_text("办结归档", timeout=10000)
            tracker.ok("Path A.5c DisposalTimeline reflects status transitions")

            # Path A.6a: Copilot chat + Markdown export download
            admin_page.locator('button.chat-fab[aria-label="打开研判助手"]').click()
            copilot_dlg = admin_page.locator('div[role="dialog"][aria-modal="true"]').filter(has_text="研判副驾驶")
            expect(copilot_dlg).to_be_visible(timeout=10000)
            copilot_dlg.get_by_label("输入研判提问").fill("请用两句话总结当前天河区高发投诉热点与处置建议。")
            copilot_dlg.locator('button[type="submit"][aria-label="发送提问"]').click()
            export_md_btn = copilot_dlg.locator('button[aria-label="导出此条回复为 Markdown"]').first
            expect(export_md_btn).to_be_visible(timeout=90000)
            with admin_page.expect_download(timeout=15000) as dl_c_info:
                export_md_btn.click()
            dl_c = dl_c_info.value
            c_path = f"/tmp/demo-abd-copilot-{int(time.time())}.md"
            temp_files.append(c_path)
            dl_c.save_as(c_path)
            c_size = os.path.getsize(c_path)
            c_text = Path(c_path).read_text(encoding="utf-8")
            tracker.check(
                c_size > 20
                and dl_c.suggested_filename.endswith(".md")
                and c_text.lstrip().startswith("# ")
                and "AI 研判简报" in c_text
                and len(c_text.strip().splitlines()) >= 2,
                f"Path A.6a Copilot Markdown exported ({dl_c.suggested_filename}, {c_size} bytes)",
            )
            copilot_dlg.locator('button[aria-label="关闭 AI 研判副驾驶"]').click()
            expect(copilot_dlg).not_to_be_visible(timeout=10000)

            # Path A.6b: /agent Daily Report generate + Markdown export download
            admin_page.goto(f"{BASE_URL}/agent", wait_until="domcontentloaded", timeout=45000)
            gen_rep_btn = admin_page.locator('button:has-text("生成今日专报")').first
            expect(gen_rep_btn).to_be_visible(timeout=45000)
            with admin_page.expect_response(
                lambda r: "/api/agent/report" in r.url and r.request.method == "POST",
                timeout=60000,
            ) as rep_info:
                gen_rep_btn.click()
            rep_res = rep_info.value
            rep_json = rep_res.json()
            if (rep_json.get("report") or {}).get("id"):
                tracker.created_report_ids.append(str(rep_json["report"]["id"]))
            tracker.check(rep_res.status == 200 and rep_json.get("success") is True, "Path A.6b Generated daily report on /agent")
            export_rep_btn = admin_page.locator('button:has-text("导出 Markdown (.md)")')
            expect(export_rep_btn).to_be_visible(timeout=15000)
            with admin_page.expect_download(timeout=15000) as dl_r_info:
                export_rep_btn.click()
            dl_r = dl_r_info.value
            r_path = f"/tmp/demo-abd-report-{int(time.time())}.md"
            temp_files.append(r_path)
            dl_r.save_as(r_path)
            r_size = os.path.getsize(r_path)
            r_text = Path(r_path).read_text(encoding="utf-8")
            tracker.check(
                r_size > 50
                and dl_r.suggested_filename.endswith(".md")
                and r_text.lstrip().startswith("# ")
                and "## 一、" in r_text
                and "## 二、" in r_text
                and ("核心态势" in r_text or "核心指标总览" in r_text),
                f"Path A.6c /agent Daily Report Markdown exported ({dl_r.suggested_filename}, {r_size} bytes)",
            )

            # =================================================================
            # PATH B (R2): L1/L2/L3 cards -> REOPEN_CALLBACK negative feedback -> Fake Closure -> /themes/[id] & /tickets?tab=pending
            # =================================================================
            admin_page.locator("#tab-agent-queue").click()
            summary_sec = admin_page.locator('section[aria-label="主动治理分层摘要"]')
            expect(summary_sec).to_contain_text("L1 自动执行", timeout=10000)
            expect(summary_sec).to_contain_text("L2 人工审批", timeout=10000)
            expect(summary_sec).to_contain_text("L3 红线熔断", timeout=10000)
            expect(admin_page.locator("article", has_text="L1 自动").first).to_be_visible(timeout=10000)
            expect(admin_page.locator("article", has_text="L2 待批").first).to_be_visible(timeout=10000)
            expect(admin_page.locator("article", has_text="L3 红线熔断").first).to_be_visible(timeout=10000)
            tracker.ok("Path B.1 /agent renders L1 (SLA_OVERDUE), L2 (MISSING_INFO/REOPEN_CALLBACK), and L3 (REDLINE_BLOCK) cards")

            reopen_card = admin_page.locator("article", has_text="48h 满意度回访").filter(has_text="待处理").first
            expect(reopen_card).to_be_visible(timeout=15000)
            reopen_card.locator('button:has-text("发起 AI 语音外呼")').click()

            voice_dlg_b = admin_page.locator("dialog.civic-voice-dialog[open]")
            expect(voice_dlg_b).to_be_visible(timeout=15000)
            voice_dlg_b.get_by_label("文字输入应答").fill("油烟还是照样吵，根本没整改")
            with admin_page.expect_response(
                lambda r: "/api/agent/outreach/voice-turn" in r.url and r.request.method == "POST",
                timeout=60000,
            ) as vt_b_info:
                voice_dlg_b.locator('button[type="submit"][aria-label="发送文本应答"]').click()
            vt_b = vt_b_info.value
            vt_b_json = vt_b.json()
            tracker.reopened_theme_id = str(vt_b_json.get("reopenedThemeId") or "")
            tracker.reopened_task_id = str((vt_b_json.get("task") or {}).get("id") or "")
            tracker.check(
                vt_b.status == 200
                and vt_b_json.get("success") is True
                and vt_b_json.get("triggeredFakeClosure") is True
                and bool(tracker.reopened_theme_id),
                f"Path B.2 Fake closure detected & reopened (theme={tracker.reopened_theme_id}, task={tracker.reopened_task_id})",
            )
            expect(voice_dlg_b).to_contain_text("触发假闭环复核告警 · 已重开督办", timeout=10000)
            reopen_link = voice_dlg_b.locator('a:has-text("查看重开专题")')
            expect(reopen_link).to_be_visible(timeout=10000)
            tracker.check(
                tracker.reopened_theme_id in (reopen_link.get_attribute("href") or ""),
                "Path B.2b VoiceOutreachDialog displays fake closure alert & reopened theme link",
            )
            confirm_b_btn = voice_dlg_b.locator('button:has-text("确认完成并刷新队列")')
            expect(confirm_b_btn).to_be_visible(timeout=10000)
            expect(confirm_b_btn).to_be_enabled(timeout=10000)
            confirm_b_btn.scroll_into_view_if_needed()
            confirm_b_btn.click()
            expect(voice_dlg_b).not_to_be_visible(timeout=15000)

            # Path B.3a: /themes/[reopenedThemeId]
            admin_page.goto(f"{BASE_URL}/themes/{tracker.reopened_theme_id}", wait_until="domcontentloaded", timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("高危督办", timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("疑似假闭环", timeout=20000)
            expect(admin_page.locator("main")).to_contain_text("处置流转时间轴", timeout=20000)
            expect(admin_page.locator("main")).to_contain_text("复发重开", timeout=20000)
            tracker.ok(f"Path B.3a /themes/{tracker.reopened_theme_id} shows 高危督办, 疑似假闭环, and 复发重开 timeline")

            # Path B.3b: /tickets?tab=pending -> page-1 假闭环 row -> /tickets/[id]
            admin_page.goto(f"{BASE_URL}/tickets?tab=pending", wait_until="domcontentloaded", timeout=45000)
            pending_tab = admin_page.locator('[role="tab"]', has_text="待派单").first
            expect(pending_tab).to_have_attribute("aria-selected", "true", timeout=45000)
            fake_row = admin_page.locator("table.workorder-table tbody tr", has_text="假闭环").first
            expect(fake_row).to_be_visible(timeout=45000)
            tracker.ok("Path B.3b /tickets?tab=pending activates 待派单 tab and shows reopened 假闭环 row on page 1")

            fake_row.locator('button:has-text("查看")').click()
            fake_drawer = admin_page.locator("dialog.civic-ticket-drawer[open]")
            expect(fake_drawer).to_be_visible(timeout=15000)
            expect(fake_drawer).to_contain_text("AI 智能研判解析", timeout=15000)
            expect(fake_drawer).to_contain_text("置信度", timeout=15000)
            expect(fake_drawer).to_contain_text("市民诉求原文", timeout=15000)
            fake_detail_btn = fake_drawer.locator('button:has-text("打开完整详情")')
            expect(fake_detail_btn).to_be_enabled(timeout=10000)
            fake_detail_btn.click()
            admin_page.wait_for_url(
                re.compile(r"/tickets/[^/?#]+"),
                wait_until="commit",
                timeout=45000,
            )
            tracker.reopened_ticket_id = admin_page.url.rstrip("/").split("/")[-1].split("?")[0]
            expect(admin_page.locator("main")).to_be_visible(timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("疑似假闭环", timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("复发重开", timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("处置流转时间轴", timeout=45000)
            expect(admin_page.locator("#ticket-status-note")).to_be_visible(timeout=45000)
            tracker.ok(f"Path B.3c Reopened ticket detail /tickets/{tracker.reopened_ticket_id} shows 疑似假闭环 & 复发重开 audit timeline")

            # =================================================================
            # PATH D (R3): Switch gz_tianhe -> ecom_demo & /screen dual-view cockpit
            # =================================================================
            admin_page.goto(f"{BASE_URL}/tickets", wait_until="domcontentloaded", timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("103,397", timeout=45000)

            tracker.track_ecom_geocode = True
            tracker.geocode_requests_in_ecom = 0

            admin_page.locator("button.region-selector-btn").click()
            listbox = admin_page.get_by_role("listbox", name="业务辖区列表")
            expect(listbox).to_be_visible(timeout=10000)
            listbox.get_by_role("option", name=re.compile(r"跨行业示范.*电商售后客诉中心")).click()

            expect(admin_page.locator("main")).to_contain_text("3,240", timeout=20000)
            ls_region = admin_page.evaluate("() => localStorage.getItem('civic_active_region')")
            ck_str = admin_page.evaluate("() => document.cookie")
            tracker.check(
                ls_region == "ecom_demo" and "active_region=ecom_demo" in ck_str,
                f"Path D.1a Top-bar switched to ecom_demo (localStorage={ls_region}, cookie=active_region=ecom_demo)",
            )

            expect(admin_page.locator("table.workorder-table thead")).to_contain_text("客诉标题", timeout=10000)
            expect(admin_page.locator("table.workorder-table thead")).to_contain_text("渠道/仓网", timeout=10000)
            admin_page.locator("table.workorder-table tbody tr").first.locator('button:has-text("查看")').click()
            ecom_drawer = admin_page.locator("dialog.civic-ticket-drawer[open]")
            expect(ecom_drawer).to_be_visible(timeout=15000)
            expect(ecom_drawer).to_contain_text("涉事SKU/店铺/承运商", timeout=10000)
            expect(ecom_drawer).to_contain_text("订单号 / 仓网地点", timeout=10000)
            tracker.check(
                ecom_drawer.locator(".civic-geo-map").count() == 0 and tracker.geocode_requests_in_ecom == 0,
                f"Path D.1b ecom_demo /tickets skips geo map & zero /api/map/geocode requests (count={tracker.geocode_requests_in_ecom})",
            )
            ecom_drawer.locator('button[aria-label="关闭工单详情抽屉"]').click()
            expect(ecom_drawer).not_to_be_visible(timeout=10000)
            tracker.track_ecom_geocode = False

            # /themes in ecom_demo
            admin_page.goto(f"{BASE_URL}/themes", wait_until="domcontentloaded", timeout=45000)
            expect(admin_page.locator("h1")).to_contain_text("多频客诉案卷", timeout=45000)
            total_theme_card = admin_page.locator("main button", has_text="总案卷数").first
            expect(total_theme_card).to_be_visible(timeout=20000)
            expect(total_theme_card.locator("div.tabular-nums")).to_have_text("40", timeout=15000)
            ecom_facet = admin_page.get_by_role("combobox", name="按渠道/仓网筛选")
            expect(ecom_facet).to_be_visible(timeout=10000)
            ecom_facet.click()
            expect(admin_page.get_by_role("option", name="天猫旗舰店")).to_be_visible(timeout=10000)
            admin_page.keyboard.press("Escape")
            tracker.ok("Path D.1c /themes switches to 40 多频客诉案卷 & e-com channels")

            # /agent in ecom_demo
            admin_page.goto(f"{BASE_URL}/agent", wait_until="domcontentloaded", timeout=45000)
            expect(admin_page.locator("main")).to_contain_text("跨行业示范 · 电商售后客诉中心", timeout=45000)
            tracker.ok("Path D.1d /agent switches to ecom_demo profile")

            # /submit in ecom_demo
            admin_page.goto(f"{BASE_URL}/submit", wait_until="domcontentloaded", timeout=45000)
            expect(admin_page.locator("h1.submit-header__title")).to_contain_text("售后客诉提交与进度追踪", timeout=45000)
            admin_page.locator("#tab-form").click()
            expect(admin_page.locator("main")).to_contain_text("渠道/仓网", timeout=10000)
            expect(admin_page.locator("main")).to_contain_text("涉事SKU/店铺/承运商", timeout=10000)
            expect(admin_page.locator("main")).to_contain_text("订单号 / 收货地或仓库", timeout=10000)
            tracker.ok("Path D.1e /submit switches to e-commerce terminology (渠道/仓网, SKU/店铺, 订单号)")

            # LightCopilot in ecom_demo
            admin_page.locator('button.chat-fab[aria-label="打开研判助手"]').click()
            ecom_copilot = admin_page.locator('div[role="dialog"][aria-modal="true"]').filter(has_text="AI 客诉研判副驾驶")
            expect(ecom_copilot).to_be_visible(timeout=10000)
            expect(ecom_copilot).to_contain_text("跨行业示范 · 电商售后客诉中心", timeout=10000)
            expect(ecom_copilot.get_by_role("button", name="渠道与SKU分布")).to_be_visible(timeout=10000)
            expect(ecom_copilot.get_by_role("button", name="食安与12315红线预警")).to_be_visible(timeout=10000)
            ecom_copilot.get_by_label("输入研判提问").fill("请用一句话简述当前电商站点的渠道分布情况。")
            ecom_copilot.locator('button[type="submit"][aria-label="发送提问"]').click()
            expect(ecom_copilot.locator('button[aria-label="导出此条回复为 Markdown"]').first).to_be_visible(timeout=90000)
            ecom_copilot.locator('button[aria-label="关闭 AI 研判副驾驶"]').click()
            expect(ecom_copilot).not_to_be_visible(timeout=10000)
            tracker.ok("Path D.1f LightCopilot switches greeting, preset pills, and live response to ecom_demo")

            # Path D.2: /screen?region=gz_tianhe -> drill-down -> switch to ecom_demo -> no snap-back -> drill-down
            admin_page.goto(f"{BASE_URL}/screen?region=gz_tianhe", wait_until="domcontentloaded", timeout=45000)
            cockpit_shell = admin_page.locator("main.cockpit-shell")
            expect(cockpit_shell).to_be_visible(timeout=45000)
            expect(cockpit_shell.locator("h1")).to_contain_text("天河区 · 智能研判全景指挥大屏", timeout=15000)
            expect(cockpit_shell.get_by_role("region", name="辖区态势地理分布图")).to_be_visible(timeout=15000)
            expect(cockpit_shell.locator(".leaflet-container")).to_be_visible(timeout=15000)
            expect(cockpit_shell.locator("div.cockpit-town-pill").first).to_be_visible(timeout=15000)
            for heading in [
                "高风险群诉",
                "实时工单接入流水",
                "研判节点实时节拍",
                "工单时序走势与多频激增脉冲",
                "24h 来电波峰",
                "镇街工单态势排行榜",
                "闭环处置全链路漏斗",
            ]:
                expect(cockpit_shell).to_contain_text(heading, timeout=15000)

            # Live stream click -> modal dialog open/close
            stream_panel = cockpit_shell.locator("div.cockpit-glass-card").filter(
                has=admin_page.locator("h2", has_text="实时工单接入流水")
            ).first
            stream_panel.locator("button").first.click()
            stream_dlg = admin_page.locator("dialog.cockpit-stream-dialog[open]")
            expect(stream_dlg).to_be_visible(timeout=10000)
            stream_dlg.locator('button[aria-label="关闭工单详情"]').click()
            expect(stream_dlg).not_to_be_visible(timeout=10000)

            # Township rank drill-down toggle
            rank_panel = cockpit_shell.locator("div.cockpit-glass-card").filter(
                has=admin_page.locator("h2", has_text="镇街工单态势排行榜")
            ).first
            first_rank_btn = rank_panel.locator("button[aria-pressed]").first
            first_rank_btn.click()
            expect(first_rank_btn).to_have_attribute("aria-pressed", "true", timeout=5000)
            first_rank_btn.click()
            expect(first_rank_btn).to_have_attribute("aria-pressed", "false", timeout=5000)
            tracker.ok("Path D.2a /screen gz_tianhe GIS map, panels, stream dialog, and rank drill-down verified")

            # Switch inside CockpitHeader to ecom_demo
            cockpit_shell.get_by_role("button", name=re.compile(r"切换业务域或站点")).click()
            cockpit_listbox = admin_page.get_by_role("listbox", name="站点与业务域列表")
            expect(cockpit_listbox).to_be_visible(timeout=10000)
            cockpit_listbox.get_by_role("option", name=re.compile(r"跨行业示范.*电商售后客诉中心")).click()

            expect(cockpit_shell.locator("h1")).to_contain_text("电商售后客诉中心 · 智能研判全景指挥大屏", timeout=15000)
            # Wait 2s to assert NO snap-back to ?region=gz_tianhe
            time.sleep(2.0)
            expect(cockpit_shell.locator("h1")).to_contain_text("电商售后客诉中心 · 智能研判全景指挥大屏", timeout=5000)

            matrix_card = cockpit_shell.locator("div.cockpit-glass-card").filter(
                has=admin_page.locator("h2", has_text="渠道/仓网客诉热度与高风险分布矩阵")
            ).first
            expect(matrix_card).to_be_visible(timeout=15000)
            expect(matrix_card).to_contain_text("8 NODES", timeout=10000)
            tracker.check(
                cockpit_shell.locator(".leaflet-container").count() == 0
                and matrix_card.locator("button[aria-pressed]").count() == 8,
                "Path D.2b /screen ecom_demo replaces GIS Leaflet map with 8-node DomainChannelMatrix without snap-back",
            )
            for heading in [
                "高风险客诉预警",
                "实时客诉接入流水",
                "渠道/仓网客诉排行榜",
                "24h 客诉波峰",
                "客诉时序走势与多频脉冲",
                "研判节点实时节拍",
            ]:
                expect(cockpit_shell).to_contain_text(heading, timeout=15000)

            channel_btn = matrix_card.locator('button[aria-pressed]:has-text("抖音直播间")').first
            expect(channel_btn).to_be_visible(timeout=10000)
            channel_btn.click()
            expect(channel_btn).to_have_attribute("aria-pressed", "true", timeout=5000)
            channel_btn.click()
            expect(channel_btn).to_have_attribute("aria-pressed", "false", timeout=5000)
            tracker.ok("Path D.2c /screen ecom_demo channel matrix drill-down & panels verified")

            # Final browser runtime health assertion
            assert_no_runtime_errors(tracker, "Final Browser Health")
            print(
                f"INFO [Browser] Tianditu tiles: ok={tracker.external_tile_ok}, errors={len(tracker.external_tile_errors)}",
                flush=True,
            )

            if citizen_ctx is not None:
                citizen_ctx.close()
            admin_ctx.close()
            browser.close()
    except Exception as exc:
        exit_code = 1
        traceback.print_exc()
        admin_url = admin_page.url if admin_page is not None else "<none>"
        citizen_url = citizen_page.url if citizen_page is not None else "<none>"
        print(
            f"ERR_STATE admin_url={admin_url} citizen_url={citizen_url}",
            file=sys.stderr,
            flush=True,
        )
        tracker.fail(f"Unhandled exception (admin_url={admin_url}, citizen_url={citizen_url}): {exc}")
    finally:
        for p in temp_files:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

        result_payload = {
            "passed": tracker.passed,
            "failed": tracker.failed,
            "pageErrors": tracker.page_errors,
            "consoleErrors": tracker.console_errors,
            "sameOriginHttpErrors": tracker.same_origin_http_errors,
            "sameOriginRequestFailures": tracker.same_origin_request_failures,
            "externalTileOk": tracker.external_tile_ok,
            "externalTileErrors": tracker.external_tile_errors,
            "geocodeRequestsInEcom": tracker.geocode_requests_in_ecom,
            "createdTicketId": tracker.created_ticket_id,
            "createdTicketNo": tracker.created_ticket_no,
            "createdTaskIds": tracker.created_task_ids,
            "createdReportIds": tracker.created_report_ids,
            "reopenedThemeId": tracker.reopened_theme_id,
            "reopenedTaskId": tracker.reopened_task_id,
            "reopenedTicketId": tracker.reopened_ticket_id,
        }
        with open(RESULT_JSON_PATH, "w", encoding="utf-8") as fh:
            json.dump(result_payload, fh, ensure_ascii=False, indent=2)

    return 1 if (exit_code != 0 or len(tracker.failed) > 0) else 0


if __name__ == "__main__":
    sys.exit(run())
