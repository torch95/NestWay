# NestWay Slider — 은퇴 금융자산 최적화 워크벤치 (`nestway_slider`, `:8089`) — 구현 체크리스트 (`todo.md`)

> **실행 규율 (`/ponytail` + `/karpathy-guidelines`)**:
> 1. 한 번에 **딱 한 가지 Task**만 수행한다. 여러 단계를 동시에 작성하거나 미래 단계의 코드를 미리 만들지 않는다.
> 2. 추측성 추상화(YAGNI)·불필요한 의존성·보일러플레이트를 배제하고 표준 라이브러리와 최소한의 명확한 코드로 구현한다.
> 3. 각 Task가 끝나면 즉시 실행/테스트 명령으로 검증한 뒤, 본 `todo.md`의 해당 항목을 `[x]`로 업데이트하고 다음 Task로 넘어간다.

---

## Phase 1: 독립 워크스페이스(`nestway_slider`) 초기화 & 백엔드(`:8089`) 구축
- [x] **Task 1.1**: 백엔드 서버(`server.py`, 포트 `:8088`, 2-Tier 인증 `/api/auth`·`/api/session`·`/api/auth/owner`·`/api/state` + 읽기전용 1,274종 ETF DB `/api/etf/list`) 및 단위 테스트(`tests/test_server.py`) 작성·검증
- [x] **Task 1.2**: 프론트엔드 빌드 파이프라인(`package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/styles.css`) 및 2-Tier 인증 게이트 셸(`src/components/PasscodeGateModal.tsx`, `src/App.tsx`, `src/main.tsx`) 구축·검증

## Phase 2: 금융 엔진 기초 계층 — 도메인 스키마, 법정 세무·건보료, 연금·ETF 모듈
- [x] **Task 2.1**: 도메인 입출력 스키마(`src/engine/types.ts`), 법정 상수(`src/engine/constants.ts`), 대표 프리셋 및 입력 정규화 팩토리(`src/engine/presets.ts`) 구현·타입 검증
- [x] **Task 2.2**: 한국 세법·건보료 정밀 계산기(`src/engine/taxAndHealth.ts` — 종소세·사적연금 Min-Tax·퇴직세·해외양도세·법인세·2024 지역건보·직장건보·급여 역산 솔버) 및 단위 테스트(`test/taxAndHealth.test.ts`) 구현·검증
- [x] **Task 2.3**: 국민연금(2026 개혁안·조기/정상/연기·추납·초과소득 감액)·부동산 전환·ETF 포트폴리오 가중평균 역산기(`src/engine/pensionAndEtf.ts`) 및 단위 테스트(`test/pensionAndEtf.test.ts`) 구현·검증

## Phase 3: 단일 정규 원장 커널(`ledgerKernel.ts`) & 다차원 수리 최적화 솔버(`optimizer.ts`)
- [x] **Task 3.1**: 단일 정규 5대 바스켓 원장 커널(`src/engine/ledgerKernel.ts` — 재직 적립기 무인출 복리 + 은퇴 D-Day 5대 바스켓 재배치 + 8단계 세금최소화 인출 워터폴 + 원가 추적) 및 1원 회계 보존 항등식 테스트(`test/ledgerInvariants.test.ts`) 구현·검증
- [x] **Task 3.2**: 황금분할 배분 솔버(`r*`)·이분탐색 한계생활비·법인 손익분기·4대 출구·연금/임원 비교·결정론적 실행 체크리스트 마스터 파이프라인(`src/engine/optimizer.ts`, `src/engine/index.ts`) 및 벤치마크 테스트(`test/optimizer.test.ts`) 구현·검증

## Phase 4: 좌측 2단 점진적 노출 컨트롤 도크 (`ControlDock` & `PrecisionTuners`)
- [x] **Task 4.1**: 좌측 핵심 컨트롤 도크(`src/components/ControlDock.tsx` — 프리셋 스위처·명목/실질 토글·상단 활성 전제 칩·4대 도메인 12개 핵심 레버) 구현·검증
- [x] **Task 4.2**: 인라인 정밀 설정 패널(`src/components/PrecisionTuners.tsx` — 부부 인별 계좌·액티브시니어·추납·다운사이징·법인 세무·1,274종 ETF 검색/포트폴리오 빌더) 구현·검증

## Phase 5: 우측 실시간 의사결정 캔버스 (`VerdictHeader` + 3대 분석 렌즈)
- [x] **Task 5.1**: 상단 고정 4대 KPI 판정 바(`src/components/VerdictHeader.tsx`) & [렌즈 1] 배분 효율 곡선·생애 순자산 궤적 SVG·법인 손익분기 카드(`src/components/Lens1AllocationTrack.tsx`) 구현·검증
- [x] **Task 5.2**: [렌즈 2] D-Day 5대 계좌 청사진 바·5대 바스켓 적층 차트·8단계 인출/마찰 차트·51개년 1원 원장 테이블 및 CSV 내보내기(`src/components/Lens2WaterfallLedger.tsx`) 구현·검증
- [x] **Task 5.3**: [렌즈 3] 법인 4대 출구·가업승계 비교, 국민연금 수령시기·추납 ROI, 1인 vs 2인 임원 비교, 시나리오 A/B 스냅샷 디퍼 및 실행 체크리스트(`src/components/Lens3StrategyMatrix.tsx`) 구현·검증

## Phase 6: UI-엔진 1원 정합성 테스트, `:8089` 데몬 기동 & 브라우저 E2E 검증
- [x] **Task 6.1**: UI-엔진 1원 정합성 테스트(`test/uiParity.test.ts`) + 정적 무결성 테스트 + `FEATURES.md` 문서화 + `:8089` systemd 데몬 등록·기동 및 헤드리스 브라우저 E2E 실측 검증

## Phase 7: 성장·배당 투자비중 가중평균 수익률 분리 & 재직기/실질가치 정합성 교정
- [x] **Task 7.1**: `evaluatePortfolio` 성장·배당 투자비중(`growthEtfRatio` : `dividendEtfRatio`) 가중평균 수익률 산출(`pensionAndEtf.ts`), 재직기(`isEmployed`) 법인 임원급여 지급 차단·초기 절세계좌 실보유액 보존(`ledgerKernel.ts`), 기본 화폐기준 `'real'` 전환(`presets.ts`) 및 단위 테스트 검증
- [x] **Task 7.2**: 좌측 컨트롤 도크(`ControlDock.tsx`)에 성장형 vs 배당형 자산 배분 비중 슬라이더 및 가중평균 수익률 요약 배지 추가, 프로덕션 번들 빌드 및 `:8089` 실측 검증

## Phase 8: 3개 은퇴 앱 표준 권장안 (`1-A` ~ `7-A`) 완전 통일 및 19개 표준 조건 검증
- [x] **Task 8.1**: `1-A`(70:30 기본 가중평균 5.40%), `2-A`(CPI 2.5% 현재 나이 50세 기산 `elapsedYears = idx`), `3-A & 4-A`(인별 ISA 1억 누적원금 한도 및 잔여 저축액 `pRatio:cRatio` 배분), `5-A`(재직기 법인 고정유지비·급여·건보 0원), `6-A`(`realized` 과세 인식 모드 통일), `7-A`(8단계 워터폴 순서 `⑥법인 출자원금 비과세 회수 ➔ ⑦일반계좌` 및 부부 사적연금 3,000만 저율 한도) 반영 및 19개 표준 조건 검증 완료

## Phase 9: 좌측 도크 숫자 입력 UX(`NumericInput`) 및 시나리오 프리셋 호버 팝업·레이아웃 보정
- [x] **Task 9.1**: 전 숫자 입력 필드(`ControlDock.tsx`, `PrecisionTuners.tsx` 총 23개)에 드래프트 버퍼링(`NumericInput` / `resolveNumericDraft`) 적용하여 다자리 숫자·소수점 입력 중 강제 클램핑 버그 해결, 시나리오 프리셋 버튼 최소 정보화 + 호버 상세 팝업(`.preset-popover`) 및 좌측 사이드바 폭(`repeat(2, minmax(0, 1fr))`) 내 완전 수납 적용
- [x] **Task 9.2**: 전체 4종 SVG 차트(`Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`)의 Y축 좌측 여백(`padL: 68 ➔ 104`) 및 우측 여백(`padR: 32~36`) 확대, 눈금 정배수 올림, `.interactive-svg { overflow: visible }` 적용으로 10억 단위 이상 금액 앞자리 잘림 현상 완전 해결
- [x] **Task 9.3**: 전체 4종 SVG 차트 모던 금융 스타일 업그레이드 — Catmull-Rom 3차 베지어 곡선(`buildSmoothPath`), 수직 그라데이션 영역(`<linearGradient>`), 축약형 억/만 단위 축(`formatAxisKRW`), 알약형 마일스톤 배지(`.svg-milestone-pill`), 재직기 배경 음영 구간, 라운드 적층 막대(`rx=2.5`) + 활성 컬럼 하이라이트(`.svg-active-col-band`), 커서 추종 플로팅 툴팁 카드(`.svg-floating-tooltip`) 적용 및 검증



## Phase 11: Top 5 개선 과제 + ETF 포트폴리오 빌더 기능 이식 (`nestway_slider`)
- [x] **T1** Top5 #2 서버 저장/복원 계약 통일(`state`→`inputs`) + 무음 실패 토스트 + `_read_json_body` dict 가드/400
- [x] **T2** Top5 #4-A 2026 건보 상수(7.19% / 13.14% / 211.5원 / 하한 20,160원) + `1.1295`·`15_000_000*personCount` 상수 참조화
- [x] **T3** Top5 #5 옵티마이저 신호 품질(`ALL_DEPLETE` status, ±3 국소탐색, 보간 플래그, 체크리스트 분기, 150ms 임계, UI 경고)
- [x] **T4** Top5 #1 사이클 1+2 — 법인 배당·임원급여 종합소득/건보 베이스 합산(2-pass), 사적연금 1인 1,500만 한도
- [x] **T5** Top5 #1 사이클 3 — 일시수령 퇴직소득세 과세 + IRP 이연퇴직소득/운용수익 분리 과세
- [x] **T6** P0 `/api/etf/list` 파라미터(q/market/category/limit/tickers)·400·isEstimated·total·4필드 + `fetchWithTimeout` + `npm test`
- [x] **T7** P1 `portfolioPresets.ts`(4종) + `scalePresetToTotal` / `holdingFromCatalogRow` + 참조 공유 해제 + category 정규화
- [x] **T8** P2 `EtfPortfolioBuilder.tsx` 프리셋 칩·델타 스트립·보유 종목·비례 맞춤·총액 불변 추가 정책 + 배우자 50:50 수정
- [x] **T9** P3 ETF 탐색기(시장/그룹/검색/Top 100/추정 배지/ISA·연금 적격 태그/3상태)
- [x] **T10** P4 detailed 가드(Step 6/10, ControlDock 접미, 해외비중, ActionGuideView) + `FEATURES.md` + `VERSION 1.1.0`
- [x] **T11** 전체 회귀·빌드·`:8089` 재기동 실측·GitHub push
