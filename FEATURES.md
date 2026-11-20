# NestWay Slider — 은퇴 금융자산 최적화 워크벤치 (`nestway_slider`, `:8089`) — FEATURES.md

## 1. 개요 및 설계 철학
- **목적**: 한국의 세법(종합소득세, 금융소득종합과세, 퇴직소득세, 해외주식 양도소득세, 법인세), 국민건강보험(2024년 재산 기본공제 1억 확대 개편안 및 직장가입자 보수월액), 국민연금(2026년 소득대체율 43% 개혁안, 조기/연기연금, 추납, 초과소득 감액)을 통합 반영하여 **은퇴 가계 자산의 개인·법인 최적 배분(`r*`)과 8단계 인출 워터폴, 법인 출구전략**을 도출하는 차세대 의사결정 워크벤치.
- **독립 실행 환경**: 로컬 워크벤치 서버(`nestway_slider`, 포트 `:8089`, 브랜드명 **NestWay Slider**)에서 외부 인프라 없이 독립 구동.

---

## 2. 단일 정규 원장 커널 (`src/engine/ledgerKernel.ts`)
- **단일 시뮬레이션 엔진**: `personalRatio ∈ [0, 1]` 파라미터 하나로 개인 100%(`r=1.0`), 법인 100%(`r=0.0`), 하이브리드(`0 < r < 1`)를 동일한 함수(`runCanonicalLedger`)에서 계산하여 전략 간 회계 불일치(Drift)를 원천 제거.
- **5대 계좌 바스켓**:
  1. `IRP / 퇴직연금`: 퇴직소득세 연금수령 감면(1~10년차 30%, 11년차+ 40% 감면 → 실효세율 60~70%) 적용.
  2. `연금저축`: 사적연금 분리과세 한도(연 1,500만/부부 3,000만, 연령별 5.5%/4.4%/3.3%) 및 한도 초과 시 `Min(16.5% 분리과세, 종합과세)` 자동 선택.
  3. `ISA (중개형)`: 3년 만기 비과세(일반 200만/서민 400만) + 9.9% 분리과세 및 연금계좌 전환(전환액의 10%, 최대 300만 세액공제) 3년 주기 롤오버 반영.
  4. `일반 과세계좌 (해외 직접투자 / 국내 상장 ETF)`: 해외 상장 직접투자분(250만 기본공제 후 22% 양도세, 건보료/종소세 제외)과 국내 상장 해외 ETF(배당소득세·금융소득종합과세 대상)의 원가(`Cost Basis`) 분리 추적. 하락장(`early_drop_30` 등)에서 평가액이 취득원가보다 낮아지는 언더워터(`taxable < taxableBasis`) 구간에서도 투자 원금(`taxableBasis`)을 강제 삭감하지 않고 보존하여, 향후 원금 회복 시 허위 양도소득세(22%)가 과세되지 않도록 보장(단, 잔고 0원 시 원가 0원, 현금 인출 시 인출 비중만큼 비례 차감).
  5. `가족법인 (투자법인)`: 법인세(2억 이하 9.9%, 200억 이하 20.9%), 직장가입자 건보료(급여 역산 솔버로 법인 현금유출 일치), 유보금 복리 재투자 및 최종 청산 시 납입자본금(무세금 원금 회수) 차감 후 잔여 잉여금 배당소득세·건보료 정산.
- **1원 회계 보존 항등식**: 모든 연도 `t`에서 `기말장부총액 - 기초장부총액 - 총투자수익 - 외부유입 + 생활비지출 + 세금건보유지비 === 0` (`accountingResidual === 0`)을 보장.
- **성장·배당 투자비중 가중평균 수익률 및 3개 앱 통합 표준(`1-A` ~ `7-A`)**:
  - `1-A`: 기본 비중 `growthEtfRatio: 70`, `dividendEtfRatio: 30` 통일(성장 6% / 배당 4% 입력 시 가중평균 연 `5.40%` = 성장 `4.20%` + 배당 `1.20%`, 전 계좌 대칭 적용).
  - `2-A`: 은퇴 생활비·고정지출·임대료(`annualRentOutflow`) 및 국민연금 물가연동(`CPI 2.5%`) 기산 시점을 현재 나이(`elapsedYears = idx`, 50세 = 0년차)로 통일.
  - `3-A & 4-A`: 기존 절세계좌(ISA·연금저축·IRP) 원금을 개인 계좌에 보존하고, 재직기 ISA 추가납입 시 1인당 누적 납입원금 1억 원 한도(부부 합산 2억 원)를 인별 추적하며, 초과 저축액은 `pRatio : cRatio`로 일반계좌 및 법인 출자원금에 배분. 비-IRP 퇴직금 일시수령(`severanceTransferToIrp === false`) 시에는 D-Day 진입 시점에 법정 퇴직소득세를 즉시 원천징수 차감한 세후 금액만 일반과세계좌 및 D-Day 청사진(`totalCapitalAtRetirement`)에 산입.
  - `5-A & 6-A`: 재직기(`isEmployed`) 중 법인 임원급여·직장건보·법인 고정유지비를 0원으로 가동 중지하며, 법인 과세 인식 모드(`realized`)에서 보유 중에는 배당수익(`corpDivReturn`)에만 법인세를 부과하고 자본성장은 인출/청산 시점에 과세.
  - `7-A`: 8단계 인출 워터폴에서 ⑥법인 출자원금(`corpPaidInCapital`) 비과세 선회수를 ⑦일반과세계좌(`taxable`) 매도보다 먼저 실행하고, 사적연금 저율 분리과세 한도를 인당 1,500만 원(부부 합산 최대 3,000만 원)으로 적용.
  - 기본 화폐 표시 기준은 **현재 구매력 기준(`viewMode: 'real'`)**으로 설정하며, 상단 토글로 명목가치(`nominal`)와 즉시 전환 가능.

---

## 3. 다차원 수리 최적화 솔버 (`src/engine/optimizer.ts`)
- **황금분할 탐색 (`solveOptimizationMasterPlan`)**: `r ∈ [0, 1]` 구간에서 세후·청산후 최종 가처분 순자산(`finalDisposableNetWorth`)을 극대화하는 최적 배분 비율 `r*`를 ~30ms 이내에 도출.
- **이분탐색 한계지출 (`solveSustainableMonthlyLiving`)**: 기대수명 시점 자산 고갈 없이 지출 가능한 최대 실질 월 생활비를만원 단위로 역산.
- **법인 설립 손익분기 진단 (`evaluateCorporateBreakEven`)**: 연간 건보료 방어액 + 세제 절감액 vs 법인 고정유지비(세무기장료 + 직장건보료)를 비교하여 손익분기 금융자산 규모를 산출.
- **4대 법인 출구전략 매트릭스 (`evaluateCorporateExitStrategies`)**: 일시 청산(납입자본금 미차감/차감), 10년 분할 감자·배당, 자녀 지분증여·가업승계 전략의 실효 세부담률과 세후 수령액 비교.
- **국민연금 시기 & 임원 구조 비교**: 조기(60세, -30%) vs 정상(65세) vs 연기(70세, +36%) 생애 누적 실수령액 및 1인 단독 vs 부부 2인 공동대표 세제·건보 비교.

---

## 4. UI 아키텍처 (단계별 집중 위저드 + 실행 가이드 & 4-타일 벤토 분석 2-모드 통합)
- **상단 2-모드 스위처 (`App.tsx`)**:
  - `① 조건 입력 (단계별 위저드)` (기본 진입 화면) ↔ `② 금융자산 구성 가이드 & 상세 분석` 2-모드로 일원화 (레거시 `⚡ 전문가 통합 뷰` 및 `ControlDock` 컴포넌트 ~1,240줄 제거, 공통 입력/도움말 프리미티브만 `ControlDock.tsx`에 유지).
- **[입력 1~5] 단계별 집중 입력 위저드 (`src/components/InputWizard.tsx`)**:
  - **한 번에 하나의 항목 입력 (`[입력 1]`)**: 10개 핵심 질문을 한 화면에 하나씩(`Step 1 은퇴시점` ~ `Step 10 법인·배분전략` + `Step 11 전체 입력 요약`) 집중 카드로 제시하여 인지 부하를 최소화.
  - **기본 설정값 유지 & 5대 연령별 프리셋 즉시 적용 (`[입력 2]`)**: 전 항목이 검증된 기본값(`DEFAULT_SIMULATION_INPUTS`, `50세 -> 60세 은퇴`)으로 채워져 있으며, 상단 프리셋 바에서 연령 순 5대 대표 프리셋(`40세 -> 45세 은퇴 (파이어족, 싱글)`, `45세 -> 50세 은퇴 (이른 은퇴)`, `50세 -> 60세 은퇴`, `55세 -> 60세 은퇴`, `60세 -> 60세 은퇴`) 및 항목별 `[기본값 복원]`을 즉시 지원.
  - **마우스 오버(`ⓘ 설명`) 도메인 팝업 (`[입력 3]`)**: `ControlDock.tsx`에서 단일 정의(`FIELD_HELP_CATALOG`, 18종)하여 위저드(`InputWizard.tsx`)와 정밀 설정 드로어(`PrecisionTuners.tsx`)에서 공유. 각 입력 항목 라벨 옆 `ⓘ 설명` 배지에 마우스를 올리면 세법·건보료 한도와 권장 입력 팁을 설명하는 팝업(`.field-help-popover`) 표시.
  - **하단 `[⚙️ 상세 입력 옵션]` 아코디언 바 (`[입력 4]`)**: Step 2(연령대별 차등 생활비 & 일시 목돈 이벤트) 및 Step 9(부동산 전환 전략 & 국민연금 수령시기/추납)에서 정밀 옵션을 같은 화면에서 즉시 조절.
  - **전체 입력 요약 확인 화면 (`[입력 5]`, `Step 11`)**: 10개 항목 입력 완료 시 전체 설정값과 맞춤/기본값 여부를 한눈에 요약하고, 항목별 `[수정 ✎]` 원클릭 점프 및 결과 화면 전환 CTA 제공.
- **[출력 1~2] 금융자산 구성 실행 가이드 & 4-타일 상세 분석 뷰 (`src/components/ActionGuideView.tsx`)**:
  - **단순·명확한 3단계 금융자산 구성 & 인출 실행 가이드 (`[출력 1]`, `.action-blueprint-hero`)**:
    1. `STEP 01 (은퇴 전 적립 공식)`: 연간 ISA·연금저축 우선 입금액 및 초과 저축분의 개인:법인 분할 적립 금액 안내.
    2. `STEP 02 (은퇴 D-Day 5대 금융계좌 최종 배치표)`: 은퇴 당일 총 운용자본을 `퇴직연금 IRP` / `중개형 ISA` / `개인연금저축` / `개인 일반과세계좌` / `가족법인 계좌(출자원금)` 5개 바구니에 각각 얼마씩(몇 %) 넣어야 하는지 시각적 스택 바와 액션 카드로 명시.
    3. `STEP 03 (은퇴 후 월 생활비 인출 공식)`: 1순위(국민연금+법인임원급여) ➔ 2순위(55세 이후 저율 연금 1,500만/인 한도) ➔ 3순위(ISA 비과세 · 법인 출자원금 무세금 회수 · 해외ETF 양도세 공제) 인출 순서 지침 제공.
  - **4대 분석 타일 셀렉터 & 온디맨드 드릴다운 (`[출력 2]`, `.analysis-tile-grid`)**:
    - `분석 01 (개인 vs 법인 최적 비율 비교)` / `분석 02 (5대 계좌 잔액 & 인출 워터폴 차트)` / `분석 03 (출구전략 · 연금시기 · A/B 비교)` / `분석 04 (51개년 연차별 현금흐름 원장 표 & CSV)` 4개 버튼 타일로 구분하며, 클릭한 타일의 상세 데이터·차트·테이블만 하단에 전개.
- **모던 금융 워크벤치 SVG 차트 엔진 (`Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`)**:
  - **Catmull-Rom 3차 베지어 스플라인(`buildSmoothPath`) & 수직 그라데이션 영역(`<linearGradient>`)**: 직선 꺾임을 제거한 부드러운 배분 효율 곡선 및 생애 순자산 궤적 렌더링.
  - **축약형 억/만 단위 축 포맷터(`formatAxisKRW`)**: Y축은 `15.6억`, `12억`, `6,000만` 등 간결한 단위로 표시하여 가독성을 극대화하고 좌측 잘림을 방지하며, 정밀 금액은 플로팅 툴팁에 표시.
  - **커서 추종 플로팅 툴팁 카드(`.svg-floating-tooltip`) & 알약형 마일스톤 배지(`.svg-milestone-pill`)**: 마우스 호버 위치에서 즉시 3대 전략 비교 및 5대 계좌/현금흐름 내역을 표시하고, 재직기 배경 음영(`.pre-retire-zone`), 라운드 적층 막대(`rx={2.5}`), 활성 연차 하이라이트 컬럼(`.svg-active-col-band`) 제공.

---

## 5. ETF 포트폴리오 빌더 — 추천 프리셋 빠른 적용 & TOP 100 / 전종목 탐색기 (v1.1.0)
- **읽기전용 ETF 카탈로그 API (`server.py` `GET /api/etf/list`)**: `etf_universe.db`(`etf_master`, 1,274종)를 `mode=ro`로만 조회. 파라미터 `q`(티커·종목명·추종지수·운용사 LIKE, 정확 티커 일치 최상단) / `market=ALL|US|KRX` / `category=ALL|INDEX|DIVIDEND|COVERED_CALL|BOND_GOLD`(DB 세부 카테고리 그룹 매핑) / `limit`(기본 100, 최대 300) / `tickers=`(≤20종 정확 조회, 요청 순서 보존). 잘못된 값은 `400`, 응답에 `total`(필터 후 전체 건수)과 `eligibleIsa`·`eligiblePension`·`underlyingIndex`·`issuer`·`isEstimated`(수집기 플레이스홀더 성장 4.5%/배당 2.0% 플래그) 포함. 모든 SQL은 바인딩 파라미터 사용(인젝션 시 0건).
- **엔진 모듈 (`src/engine/portfolioPresets.ts`)**: 4종 추천 프리셋(`배당성장 코어` VOO40/SCHD30/360750 20/JEPI10 · `올웨더 방어` VOO40/TLT30/GLD15/SCHD15 · `월배당 현금흐름` JEPI35/JEPQ35/SCHD30 · `국내상장 절세` 360750 50/446720 50)은 티커·비중만 보유하고 수익률·보수 메타는 런타임에 카탈로그에서 해석. `scalePresetToTotal`/`applyPresetToHoldings`(floor + 잔여를 마지막 종목에 귀속 → Σ금액 == 총액 보장, 카탈로그에 없는 종목은 제외 후 재정규화), `holdingFromCatalogRow`(DB `product_type` 우선, 무효 시 시장 기준 폴백), `rebalanceHoldingsToTotal`(비례 맞춤), `addHoldingKeepingTotal`(신규 종목 = 총액 ÷ (N+1), 기존 종목 비례 축소 → 총액 불변).
- **UI (`src/components/EtfPortfolioBuilder.tsx`, Step 6 상세 옵션 & 정밀 설정 그룹 B · 입력 방식 "직접 구성" 선택 시)**: ① 프리셋 칩 클릭 → 적용 전/후 델타 스트립(성장·배당·실부담보수·해외직투 변화, 추정치 포함 경고) → `[이 프리셋 적용]`; ② 보유 종목 표(비중 배지, 만원 단위 편집, 제거 시 잔여 종목 비례 재배분) 및 보유 합계 ≠ 총 투자금 시 `[비례 맞춤]`; ③ 탐색기: 시장(한·미 전체/미국 직투/국내 상장) × 자산군(지수·성장/배당/커버드콜/채권·금·리츠) 필터, AUM 상위 100 기본 노출 + 전종목 검색, `추정`/`ISA`/`연금` 편입 가능 배지, 로딩·빈 결과·오류 상태 표시. 모든 요청은 `fetchWithTimeout`(8초 AbortController) + `X-Fincorp-Session` 헤더.
- **직접 구성 모드 가드**: 위저드 Step 4·6, 전문가 도크, 실행 가이드 ③에서 "보유 ETF N종 가중" 배너/문구로 요약 수익률(성장·배당 입력, 70:30 슬라이더)이 참고용임을 명시하고, 총 투자금 슬라이더 변경 시 보유 종목을 비례 조정, 해외직투 비중은 보유 종목에서 자동 산출(읽기 전용). 거시(macro) → 직접 구성 전환 시 기존 보유 종목을 현재 총 투자금에 자동 비례 맞춤.
- **거시 vs 직접 구성 수익률 차이 안내**: 거시 모드는 보수 차감 없이 `성장 6% × 70% + 배당 4% × 30% = 연 5.40%`를 전 계좌에 적용하지만, 직접 구성 모드는 종목별 `expected_growth`·`dividend_yield`에서 `actual_expense_ratio`를 차감한 가중평균(예: 스타터 3종 ≈ 연 9.79%)을 사용하므로 같은 자산이라도 결과가 달라질 수 있음. 해외직투 비중 역시 거시 모드는 입력값(70%), 직접 구성은 `market === 'US' || productType === 'overseas_direct'` 종목 금액 비중으로 계산.

---

## 6. v1.1.0 금융 엔진 신뢰성 보강 (Top 5 개선 과제 반영)
- **저장/복원 계약 통일 (`App.tsx` ↔ `server.py`)**: `POST/GET /api/state`는 `{ inputs }` 키만 사용, 비객체 본문·잘못된 `inputs`는 `400`, 403 시 소유자 세션 만료 처리, `guest_reset` 분기, 저장 실패를 토스트로 노출.
- **2026 건보 상수화 (`constants.ts`)**: 건강보험료율 7.19%, 장기요양 13.14%, 지역가입자 점수당 211.5원, 지역 최저보험료 20,160원/월, 소득 최저 산정 336만원/년, 사적연금 저율 한도 인당 1,500만원 상수 참조.
- **옵티마이저 신호 품질 (`optimizer.ts`)**: 동률 시 순자산 → 고갈 시점(늦을수록) → 미충족 생활비(적을수록) 타이브레이크, 조밀 국소 탐색(±5/3/2/1 + ±1 힐클라임)으로 전수 탐색과 r* 일치, 모든 비율에서 고갈 시 `allocationStatus: 'ALL_DEPLETE'` + 실행 가이드 헤드라인 분기, 보간 구간 플래그(`sustainableIsInterpolated`), 입력 조건 반영 체크리스트 문구.
- **종합소득 합산 과세 (`taxAndHealth.ts`, `ledgerKernel.ts`)**: 법인 배당 → 임원 근로소득 과세표준 위에 누진 적립(`calculateIndividualCombinedTax(..., otherComprehensiveTaxableBase)`), 당해 배당은 익년 지역건보 소득 산정에 반영, 사적연금 인당 1,500만 한도 인별 추적(`pensionSelfShare`).
- **퇴직소득세 & IRP 2단 과세**: 일시수령 시 근속연수공제·환산급여공제 기반 법정 퇴직소득세(`calculateRetirementIncomeTax`, 3억/20년 = 19,844,000원 검증), IRP 인출은 이연퇴직소득분(법정세액의 70%/60%)과 운용수익분(인별 연금소득세)으로 분리 과세. `serviceYears`는 입력 UI 미노출 시 `은퇴나이 − 27`(1~40 클램프) 기본값 사용.
- **알려진 한계**: ISA는 4-c(3년 만기 롤오버·전환 세액공제) 단순화 모델 유지; 프리셋 후보였던 `448290`은 수집기 데이터 이슈로 제외; `serviceYears` 입력 필드는 미노출(엔진 옵션만 제공).

---

## 7. v1.1.0 Step 1~9 입력 UX & 금융 엔진 정밀도 개선 (Tab 2 전면 반영)
- **Step 1~9 위저드 및 전문가 도크 정합성**:
  - **Step 1**: 가구 구성(`부부 합산` / `1인 단독`)과 배우자 현재 나이를 기본 카드에 직접 배치하고 불필요한 상세 옵션 토글을 제거.
  - **Step 2**: `activeSeniorDelta`가 소수(`0.25`) 또는 백분율(`25`) 어느 형태로 저장되어도 `getMonthlyLivingExpenseForAge`와 `PrecisionTuners.tsx`에서 `25%`(`1.25배`)로 일관되게 처리하도록 정규화하고, `은퇴 후 월 고정지출` 라벨을 명확화.
  - **Step 3**: **일반계좌 월 저축액 (`generalMonthlySavings`)**과 **절세계좌(ISA·연금저축) 월 환산 추가납입액 (`shelteredMonthlyEquiv`)**을 분리 표시하여, 절세계좌 연간 추가납입액 변경 시 일반계좌 월 저축액이 잠식되지 않고 총 월 저축액(`preRetirementMonthlySavings`)이 투명하게 합산되도록 개선.
  - **Step 4 & Step 5**: 현재 시점 보유 금액임을 명시(`현재 보유 잔고 기준`). Step 5에 `은퇴 시 예상 퇴직금` 슬라이더/입력(`ⓘ 설명` 포함), `퇴직금 전액 IRP 이연` 체크박스, 퇴직금 세제 요약 배너를 통합하고, 실제 엔진에서 사용되지 않던 `IRP 연금 인출 희망 월액` 유령 입력을 제거.
  - **Step 6**: 5대 계좌 바스켓 안내 캡션 추가, 계좌별 개별 수익률 직접 지정 시 **ISA / 연금저축 / 퇴직연금(IRP) 3개 계좌 수익률(`irpExpectedReturnRate` 분리)**을 각각 설정할 수 있도록 확장하고, `[⚡ IRP 위험자산 70% 한도 자동계산 (주식형 70% + 안전자산 3.5%×30%)]` 원클릭 버튼과 `<EtfPortfolioBuilder />`(추천 프리셋 및 1,274종 검색)를 Step 6 상세 옵션에서도 바로 사용할 수 있도록 연결.
  - **Step 7 & Step 8 & Step 9**: 전문 약어 `(SORR 테스트)` 표기를 제거하고, Step 8 기본 카드에 배우자 국민연금 및 주택 소유 명의(`단독`/`부부 공동`)를 전면 배치하며, 상세 옵션에서 주택 축소 후 공시가격·매각 후 반전세/월세 전환 조건·본인/배우자 개별 국민연금 추납을 모두 지원. Step 9에서는 직장건보 피부양자 방어용으로 고정된 `임원 1인당 실수령 월급` 및 미사용 `분할 배당 출구 기간` 입력을 제거하고 `법인 대표·임원 구성` `ⓘ 설명` 배지를 제공.

---

## 8. v1.2.1 수익률 입력 직관화 · 금융자산 개시연령/적립 브릿지 · 차트/원장 전문가 뷰 고도화 (Tab 3 전면 반영)
- **Pillar 1 — Step 6 목표수익률 메인 카드 2-모드 탭 & 산출식 전면 배치 (`InputWizard.tsx`)**:
  - 상세 입력 옵션 서랍을 열지 않고도 Step 6 메인 카드에서 즉시 **`[📊 요약 비중·수익률 설정]`**과 **`[🧩 추천 포트폴리오 & ETF 직접 구성 (1,274종)]`**을 전환(`wizard-return-mode-tabs`)하여 4종 추천 포트폴리오 프리셋과 한·미 1,274종 ETF 탐색기를 사용할 수 있도록 승격.
  - 메인 카드 상단에 **5대 계좌 통합 가중평균 산출 공식 배지**(`예: 6.0% × 70% + 4.0% × 30% = 연 5.40%`)를 명시하고, `[🧩 추천 포트폴리오 & ETF 직접 구성]` 모드 선택 시 작동하지 않는 요약 슬라이더를 숨겨 이중 노출 혼선을 원천 차단.
  - Step 4 일반 금융자산 `NumericInput` 직접 타이핑 시에도 슬라이더와 동일하게 상세 ETF 보유 금액을 자동 비례 조정(`rebalanceHoldingsToTotal`)하도록 동기화하고, Step 4 상세 옵션의 중복 `<PrecisionTuners group="B" />` 블록을 제거.
  - Step 10 전체 입력 요약의 `[6. 목표수익률]` 카드가 계좌별 수익률 직접 지정(`useSeparateAccountReturns`) 및 추천 ETF 직접 구성(`isDetailedPortfolio`) 상태를 정확히 표시하도록 개선.
- **Pillar 2 — 금융자산 적립 브릿지(`현재 잔고 ➔ D-Day 잔고`) & 사적연금 개시연령 원장 커널 연동 (`ledgerKernel.ts`, `ActionGuideView.tsx`)**:
  - `ledgerKernel.ts` Stage `⑤-1 (연금저축)` 및 `⑤-2 (퇴직연금 IRP)` 인출 개시 조건에 사용자 지정 개시 연령(`Math.max(55, selfPersonalPensionStartAge)` 및 `Math.max(55, selfRetirementPensionStartAge)`)을 정식 연동하고, IRP 이연퇴직소득 원금 소진 후 운용수익분(`pensionPart`) 인출 시 잔여 저율 한도(`irpLowTaxCap = Math.max(0, lowTaxCap - stage5)`)를 우선 적용하여 `⑥ 법인 출자원금(0% 비과세)`보다 먼저 16.5% 페널티 세율이 부과되는 역전을 방지 (`1,877개 시나리오-연차 전수 accountingResidual === 0원` 검증).
  - `ActionGuideView.tsx`의 `STEP 02 (은퇴 D-Day 5대 금융계좌 최종 배치표)` 각 계좌 카드 하단에 **`현재 잔고 ➔ 재직 중 추가납입/퇴직금 이연 + 복리 운용 ➔ 은퇴 D-Day 잔고`** 1줄 적립 브릿지(`.action-basket-bridge`)를 표시하고, `STEP 01`에 예상 퇴직금의 D-Day 유입 경로(IRP 전액 이연 vs 세후 일반계좌 합산) 안내를 추가하여 "내가 입력한 현재 자산과 퇴직금이 어떻게 D-Day 배치 금액이 되었는지" 직관적으로 검증 가능.
- **Pillar 3 — 전문가급 차트 스케일링·범례 분리·원장 인라인 브레이크다운 및 산출 근거 팝업 (`Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`)**:
  - **배분 효율 곡선(`Lens1`)**: Y축을 `[yFloor, yCeil]` 동적 범위로 확대 스케일링하여 배분 비율(`0%~100%`)에 따른 순자산 차이를 선명하게 부각하고, 5단계 그리드 라인과 호버 툴팁 내 `(최적 대비 격차, 세후 생활비 충족률, 세금·건보 총액)` 상세 지표를 추가.
  - **생애 순자산 궤적(`Lens1`)**: 5단계 그리드 라인, 10년 단위 데이터 포인트 마커, 사적연금 개시 연령 마일스톤 수직선, 호버 시 3대 전략의 `총장부자산 / 누적 세금·건보·유지비` 동시 비교 툴팁 제공.
  - **5대 계좌 잔액 & 연간 생활비 충당 원천 차트(`Lens2`)**: 기존에 하나의 범례로 묶여 있던 절세계좌를 **`③ 중개형 ISA (비과세)` · `④ 개인연금저축` · `⑤ 퇴직연금 IRP` 3개 독립 범례**로 분리하고, `② 법인 임원급여`(`#4f46e5` 인디고)와 `⑥ 법인 출자원금/배당`(`#9333ea` 퍼플)의 색상을 명확히 구분하며, Chart 2 호버 툴팁에 당해 활성화된 모든 인출 원천(국민연금·임원급여·ISA·연금저축·IRP·법인가수금·일반계좌·법인배당)과 세금·건보·유지비를 빠짐없이 표시.
  - **51개년 연차별 현금흐름 원장 테이블(`Lens2`)**: `외부유입` · `인출원천 요약` · `세금·건보·유지비` 셀에 주요 구성을 2줄 인라인 서브텍스트(`.ledger-cell-breakdown`)로 즉시 표시하고, `세금·건보·유지비` 셀 우측 **`ⓘ` 배지 호버 시 7대 세목·건보료·유지비 상세 영수증 팝업(`.ledger-why-popover`)**을 노출.

---

## 9. v1.2.2 단계별 위저드 입력 순서 최적화(후보 1) & 듀얼 스코프 ETF 포트폴리오 빌더(방식 B · 절세·연금 KRX 전용 프리셋 5종)
- **후보 1(Candidate 1) 자산-현금흐름-수익률 인지 흐름 재정렬 (`InputWizard.tsx`)**:
  - **1~2단계(생애 목표)**: `1. 은퇴시점` ➔ `2. 목표생활비`
  - **3~4단계(현재 보유 금융자산 스냅샷)**: `3. 일반금융자산 (개인 일반과세 + 가족법인 현재 잔고)` ➔ `4. 절세·연금계좌 (현재 IRP·연금저축·ISA 잔고 + 은퇴 시 예상 퇴직금)`
  - **5단계(미래 적립 현금흐름)**: `5. 은퇴전저축 (일반계좌 월 저축액 + 절세계좌 월 환산 추가납입액)` — Step 4에서 확인한 절세계좌 현황 직후에 추가납입액을 설정하도록 직결.
  - **6단계(운용 전략 & 수익률)**: `6. 목표수익률` — Step 3~4에서 확정된 5대 계좌 원금 전체를 대상으로 요약 수익률 또는 계좌군별 ETF 포트폴리오를 한곳에서 설계.
  - **7~9단계(리스크·인출·배분)**: `7. 안전버퍼·위기` ➔ `8. 국민연금·주택` ➔ `9. 개인·법인 배분` ➔ `10. 전체 입력 요약`.
- **방식 B(Method B) 단일 컴포넌트 듀얼 스코프 ETF 빌더 (`EtfPortfolioBuilder.tsx`, `portfolioPresets.ts`, `pensionAndEtf.ts`)**:
  - `<EtfPortfolioBuilder scope="general" | "sheltered" />` 단일 컴포넌트 재사용으로 코드 중복 없이 **`[🌐 일반 · 법인 금융계좌 ETF (한·미 1,274종)]`**와 **`[🛡️ 절세 · 연금계좌 KRX 전용 ETF (ISA·연금저축·IRP)]`**를 탭으로 전환.
  - **절세·연금 맞춤 국내상장 6대 코어 ETF 기반 추천 프리셋 5종 (`SHELTERED_PORTFOLIO_PRESETS`)**:
    1. `절세 미국지수 코어` (`360750` TIGER 미국S&P500 50% + `133690` TIGER 미국나스닥100 30% + `458730` TIGER 미국배당다우존스 20%)
    2. `절세 배당성장 밸런스` (`360750` TIGER 미국S&P500 40% + `458730` TIGER 미국배당다우존스 40% + `273130` KODEX 종합채권(AA-이상)액티브 20%)
    3. `한·미 대표지수 균형` (`360750` TIGER 미국S&P500 40% + `069500` KODEX 200 20% + `292150` TIGER TOP10 20% + `273130` 국내채권 20%)
    4. `IRP 70% 한도 안심포트` (`360750` TIGER 미국S&P500 35% + `133690` TIGER 미국나스닥100 15% + `458730` 미국배당다우존스 20% + `273130` 국내채권 30%)
    5. `국내 우량·배당 인컴` (`458730` TIGER 미국배당다우존스 40% + `069500` KODEX 200 20% + `292150` TIGER TOP10 10% + `273130` 국내채권 30%)
  - **KRX 전용 자동 필터링 및 계좌별 수익률·IRP 70% 한도 실시간 동기화**: 절세·연금 스코프 선택 시 해외직투(US) 종목을 제외하고 국내상장(KRX) ETF만 탐색하며, 종목/프리셋 변경 즉시 `isaExpectedReturnRate` · `personalPensionReturnRate`(= 세전 가중수익률 - 실부담보수)와 `irpExpectedReturnRate`(= IRP 70% 위험자산 한도 체크 시 `주식형 70% + 안전자산 3.5%×30%`)에 자동 반영. Step 4에서 절세계좌 잔액 변경 시에도 `shelteredHoldings` 총액이 자동 비례 리밸런싱(`updateShelteredAccountsWithSync`)됨.

---

## 10. v1.2.3 목표수익률 2단계 슬라이드 분리 (`6. 일반·법인 수익률` / `7. 절세·연금 수익률`) 및 Step 3·4 입력 UX 정교화
- **목표수익률 슬라이드 2단계 분리 (10단계 집중 위저드 + Step 11 입력 요약)**:
  - 기존 단일 `6. 목표수익률` 슬라이드에 집중되어 있던 2중 탭(간편 vs ETF 빌더 × 일반·법인 vs 절세·연금)을 **`6. 일반·법인 수익률`**과 **`7. 절세·연금 수익률`** 두 개의 독립 위저드 슬라이드로 분리하여 한 슬라이드당 하나의 계좌군에만 집중하도록 구조화(후속 단계는 `8. 물가·시장환경` ➔ `9. 부동산·국민연금` ➔ `10. 법인·배분전략` ➔ `Step 11 입력 요약`으로 이동).
  - **`6. 일반·법인 수익률`**: 기본 카드에서 성장:배당 투자 비중 슬라이더, 성장률·배당률, 그리고 **일반계좌 내 해외상장 ETF 직접투자 비중(`overseasEtfRatio`)**을 한눈에 설정하며, 상단 `[⚙️ 상세 입력 옵션]`을 열면 `<EtfPortfolioBuilder scope="general" />`(4종 추천 프리셋 + 한·미 1,274종 ETF 탐색기)가 전개됨.
  - **`7. 절세·연금 수익률`**: 기본 카드에서 `[일반·법인 계좌와 동일 수익률 적용 (기본)]` vs `[절세·연금계좌 수익률 별도 설정 (IRP 70% 한도 반영)]` 선택, ISA·연금저축·IRP 3계좌 기대수익률 및 `IRP 위험자산 70% 한도 자동 계산` 버튼을 제공하며, 상단 `[⚙️ 상세 입력 옵션]`을 열면 `<EtfPortfolioBuilder scope="sheltered" />`(국내상장 KRX 6대 코어 ETF 기반 5종 추천 프리셋 + KRX 전용 탐색기)가 전개됨.
- **`3. 일반금융자산` 상세 옵션 제거 및 해외직투 비중 이관**:
  - `3. 일반금융자산` 슬라이드에서는 오직 현재 보유 일반 금융자산 총액(`totalInvestment`)만 입력하도록 `[⚙️ 상세 입력 옵션]` 서랍을 제거하고, `overseasEtfRatio`를 `6. 일반·법인 수익률` 기본 카드로 이관하여 모든 투자 비중·수익률 의사결정을 Step 6~7에 일원화.
- **`4. 절세·연금계좌` 퇴직연금 vs 퇴직금 명확화, 배우자 예상 퇴직금 분리 과세(`spouseExpectedSeverancePay`), 사적연금 자동 개시 일원화 및 `[ⓘ 설명]` 배지 레이아웃 고정**:
  - `① 본인 퇴직연금(IRP/DC) 현재 잔액`(현재 이미 적립되어 은퇴 전까지 복리 운용되는 잔고)과 `은퇴 시 추가 수령할 예상 퇴직금`(재직 중 향후 회사 DC 추가 불입분 + 은퇴 시 수령할 법정 퇴직금/명예퇴직금 합산액, 은퇴 D-Day에 일시 유입)의 차이와 IRP 이체 체크박스의 3대 세제 효과를 인라인 안내 배너 및 `FIELD_HELP_CATALOG`에 명시.
  - **배우자 은퇴 시 예상 일시 퇴직금(`spouseExpectedSeverancePay`) 분리 입력 및 인별 과세·IRP 지분 반영**: 맞벌이 부부 가구가 Step 4 `[⚙️ 상세 입력 옵션]`(및 좌측 전문가 독)에서 배우자 예상 퇴직금을 별도 입력할 수 있도록 지원하여, 부부 퇴직금을 한 칸에 합산할 때 발생하던 누진 퇴직소득세 과대 계상을 해소하고(본인·배우자 각자의 근속연수공제 및 환산급여 누진세율 개별 적용), IRP 이연 시 배우자 지분(`irpSpouseContrib`)에 정확히 산입되어 55세 이후 연 1,500만 원 저율 분리과세(3.3~5.5%) 한도가 인별로 온전히 활용되도록 개선.
  - Step 4 상세 옵션에서 수동 `사적연금(연금저축·IRP) 수령 개시 연령 (최소 55세)` 입력란을 제거하고, 엔진의 8단계 세제 최적 인출 워터폴(`Math.max(retireAge, 55)` 이후 비과세 재원 소진 시 자동 개시)로 일원화(1인 가구 선택 시 Step 4 상세 옵션 버튼 자동 숨김).
  - 긴 필드 라벨 옆에서도 `[ⓘ 설명]` 배지가 세로로 찌그러지지 않도록 `src/styles.css`의 `.field-help-trigger` 및 `.field-help-icon`에 `flex-shrink: 0; white-space: nowrap;` 적용.

---

## 11. v1.2.4 세무·건보 영수증 세분화(Phase A) · 비정기 일회성 현금흐름 이벤트(Phase B) · 1-Click PDF 마스터플랜 리포트(Phase C) · 결정론적 수익률 민감도 밴드 & 생존확률(Phase D) 및 모션 폴리시
- **Phase A — 세무·건보 정밀도 감사 및 4대 개인세목 영수증 세분화 (`src/engine/ledgerKernel.ts`, `src/engine/taxAndHealth.ts`, `Lens2WaterfallLedger.tsx`)**:
  - **`GAP-02` 국민연금 추납(`applyAdditionalPensionSelf/Spouse`) 일시 납입 원금 차감 동기화**: 은퇴 전환 연차(`ageSelf === Math.max(currentAgeSelf, targetRetirementAgeSelf)`, 이미 은퇴한 가구는 시뮬레이션 첫해)에 본인·배우자 추납 원금(`additionalMonths * monthlyContribution`)을 당해 순현금 잉여분(`coveredByCashSurplus`)으로 우선 충당하고 부족분을 일반과세계좌(`taxable` 및 `taxableBasis`)에서 차감하며 `additionalPensionContribution` 필드에 기록하여 `accountingResidual === 0원` 항등식을 유지.
  - **`GAP-03` 100세 기말 가처분 순자산(`endDisposableNetWorth`)의 개인·법인 대칭 청산세 반영 (`resolvePersonalExitNetWorth`)**: 법인 청산 배당소득세(`resolveCorporateExitNetWorth`)와 대칭되도록, 시뮬레이션 종료 시점 개인 일반과세계좌 미실현 해외 ETF 양도차익 잠재 세금(기본공제 250만/부부 500만 후 22%) 및 연금저축·IRP 잔여액의 잠재 연금소득세/퇴직소득세를 차감하여 공정 비교 확립.
  - **부부 해외주식 양도소득세 기본공제 합산(연 500만 원)**: `hasSpouse === true`일 때 부부 증여·분산 매도를 통한 인당 250만 원 × 2인 = **연 500만 원 기본공제**를 `calculateOverseasCapitalGainsTax`에 반영.
  - **개인 소득세 4대 세목 영수증 세분화 & 건보 피부양자 적격 배지**: `CanonicalYearRow`에 `taxPublicAndDiv`(종합소득·배당·공적연금세), `taxPrivatePensionAndIrp`(연금저축·IRP 연금소득세/퇴직소득세), `taxOverseasCapGains`(해외주식 양도소득세 22%), `taxIsaAndSeveranceLump`(ISA 만기 9.9%·일시퇴직소득세) 및 `isHealthDependentEligible`을 추가하여 51개년 원장 `ⓘ` 영수증 팝업(`.ledger-why-popover`)에서 1원 단위까지 투명하게 검증 가능 (`taxPublicAndDiv + taxPrivatePensionAndIrp + taxOverseasCapGains + taxIsaAndSeveranceLump === personalIncomeTax`).
- **Phase B — 가구 생애주기 비정기 일회성 현금흐름 이벤트 슬롯 (`Lump-Sum Cashflow Events`)**:
  - **최대 5개 이벤트 슬롯 & 4종 원클릭 추천 프리셋 (`PrecisionTuners.tsx`, `InputWizard.tsx`, `ControlDock.tsx`)**: Step 2 상세 옵션(및 전문가 정밀 설정 그룹 A)에서 `🎓 자녀 교육·유학 (-5,000만)`, `💍 자녀 결혼 지원 (-1.5억)`, `🏦 주담대 완납 (-1억)`, `🎁 상속·증여 유입 (+2억)` 프리셋 칩 또는 직접 추가를 통해 특정 연령의 목돈 지출(`outflow`)/유입(`inflow`, 비과세 원금으로 `pRatio:cRatio` 배분)을 설정(금액은 현재가치 만원 단위로 입력 후 해당 연령까지 물가상승률 자동 반영)하고 활성 전제조건 바에 요약 칩을 노출.
  - **원장 통합 및 인라인 브레이크다운 (`ledgerKernel.ts`, `Lens2WaterfallLedger.tsx`)**: 유입은 `totalExternalInflow`(`lumpSumInflowLabels`), 유출은 `requiredLivingOutflow`(`lumpSumOutflowLabels`)에 분리 합산하고, 재직기(`isEmployed`) 대규모 일시 지출 시에도 해외주식 양도소득세 Gross-Up, 법인 출자원금 비과세 한도(`corpPaidInCapital`), ISA/법인배당 폴백을 정합하게 수행하여 전 구간 `accountingResidual === 0원`을 보존.
- **Phase C — 1-Click PDF 마스터플랜 리포트 (`ActionGuideView.tsx`, `App.tsx`, `src/styles.css`)**:
  - 상단 헤더(`🖨️ PDF 리포트`) 및 `② 금융자산 구성 가이드` 히어로 우측 상단(`🖨️ PDF 마스터플랜 리포트 출력`) 버튼 클릭 시 어느 뷰 모드(`wizard`/`guide`/`workbench`)에서든 `isPrintMode`를 활성화하여 3단계 실행 공식, D-Day 5대 계좌 배치표, 그리고 3대 분석 렌즈(`Lens1AllocationTrack`, `Lens2WaterfallLedger`, `Lens3StrategyMatrix`) 전체를 동시에 마운트한 뒤 브라우저 인쇄/PDF 저장(`window.print()`)을 호출하고 `afterprint` 시 원래 뷰로 복귀.
  - `@media print` 전용 스타일시트(A4 Landscape, 라이트 인쇄 팔레트 강제 적용, 네비게이션·툴바·팝오버·호버배지 숨김, 카드/차트 `break-inside: avoid`, 51개년 원장 스크롤 해제 전체 표 출력) 내장.
- **Phase D — 결정론적 수익률 민감도 밴드(`±2.0%p`) & `P10 / P50 / P90` 100세 생존확률 (`src/engine/sensitivityBand.ts`, `Lens1AllocationTrack.tsx`)**:
  - 외부 라이브러리 없이 시드 고정 PRNG(`mulberry32`)와 정규분포 역변환을 사용하여 현재 선택된 활성 배분 비율(`activeLedger.personalRatio`) 기준 **수익률 `-2.0%p` / `기준` / `+2.0%p` 결정론적 경로**와 25회 시드 고정 샘플링 기반 **`P10`(보수적 하위 10%) · `P50`(중위) · `P90`(낙관적 상위 10%) 기말 가처분 순자산 및 100세 자산 생존확률(%)**을 ~15ms 이내에 산출.
  - `Lens 1` 생애 순자산 궤적 차트 헤더의 `[📈 수익률 변동 밴드(±2%p · P10~P90) & 100세 생존확률 보기]` 토글 클릭 시 요약 스트립(`.sensitivity-summary-strip`)과 SVG 신뢰구간 영역 폴리곤(`.sensitivity-confidence-band`)을 즉시 오버레이.
- **인터랙션 & 모션 엔지니어링 폴리시 (`emil-design-eng` & `design-taste-frontend`, `src/styles.css`)**:
  - 커스텀 이징 토큰(`--ease-out: cubic-bezier(0.22, 1, 0.36, 1)`, `--ease-in-out: cubic-bezier(0.65, 0, 0.35, 1)`, `--ease-drawer: cubic-bezier(0.32, 0.72, 0, 1)`) 도입, `transition: all` 제거 및 명시적 프로퍼티 트랜지션 적용, 모든 인터랙티브 버튼에 `:active:not(:disabled) { transform: scale(0.97); }` 촉각 피드백 부여, 팝오버 `transform-origin` + `@starting-style` 진입 모션, `@media (hover: hover) and (pointer: fine)` 터치 디바이스 호버 오작동 가드 적용.

---

## 12. v1.2.5 위저드 단계별 정보 노출 정합화 · 초기화 확인 가드 · 상세 서랍 아키텍처 정리 및 Step 6·7·10 모드 탭 일원화 (Tab 3 문서 항목 1~8 전면 반영)
- **항목 1 — 자산 입력 전(Step 1~2) 자산 종속 예측치 조기 노출 차단 (`InputWizard.tsx`)**:
  - `1. 은퇴시점` 및 `2. 목표생활비` 단계에서는 아직 보유 금융자산(Step 3~4)과 은퇴 전 저축(Step 5)을 입력하기 전이므로, 하단 푸터의 `100세 예상 세후 순자산` 대신 `"단계 1~2 / 10 · 3~5단계에서 보유 자산·저축 입력 후 100세 예상 순자산이 표시됩니다"` 안내를 표시하고, Step 2 컨텍스트 필의 `현재 자산 기준 100세 지속가능 최대 월생활비` 대신 `"연간 목표 순생활비 & 은퇴 후 소비 기간 (연 X,XXX만원 · 은퇴 후 YY년)"`을 노출. Step 3부터 실시간 `100세 예상 세후 순자산`을 점진적으로 활성화.
- **항목 2 & 6-a — `[ⓘ 설명]` 팝오버 줄바꿈 결함 수정 및 우측 화면 잘림 방지 (`src/styles.css`)**:
  - 부모 버튼(`.field-help-trigger`, `.wizard-return-mode-tab` 등)의 `white-space: nowrap`이 `.field-help-popover` 내부로 상속되어 텍스트가 한 줄로 길게 뻗어 나가던 CSS 버그를 해결하기 위해 `.field-help-popover` 및 하위 요소(`.field-help-title`, `.field-help-summary`, `.field-help-rule`, `.field-help-tip`)에 `white-space: normal; word-break: keep-all; overflow-wrap: break-word;`를 명시하고, 우측 라벨 행(`.dock-label-row .field-help-popover`)에서는 `left: auto; right: 0;`으로 우측 정렬하여 화면 밖 잘림을 원천 차단.
- **항목 3 — 초기화 버튼(`전체 기본값 초기화` · `기본값 복원`) 오클릭 방지 확인 창 및 주의 색상 구분 (`InputWizard.tsx`, `src/styles.css`)**:
  - 상단 `[↺ 전체 기본값 초기화]` 및 카드 내 `[↺ 기본값 복원]` 클릭 시 `window.confirm(...)` 확인 대화상자를 거치도록 보호하고, 일반 보조 버튼과 시각적으로 구분되도록 시맨틱 주의/경고(Red-Rose) 테두리·배경 스타일(`.wizard-reset-btn`, `.step-reset-btn`) 적용.
- **항목 4 & 5 — `[⚙️ 상세 입력 옵션]` 하단 이동 및 Step 4·5·8·10 기본 카드 승격 (`InputWizard.tsx`, `src/styles.css`)**:
  - `[⚙️ 상세 입력 옵션]` 버튼을 카드 우측 상단에서 **기본 입력 박스(`.wizard-primary-input-box`) 바로 아래 전폭 아코디언 바(`.wizard-detail-toggle-bar`)**로 이동하여 위→아래 시선 흐름과 아코디언 전개 위치를 일치시킴.
  - Step 4(배우자 절세·퇴직연금 3종 잔액 및 배우자 예상 퇴직금), Step 5(본인·배우자 ISA 및 연금저축 연간 추가납입액), Step 8(은퇴 직후 시장 하락장 스트레스 시나리오), Step 10(가족법인 등기임원 수·세율·유지비·청산 과세 `PrecisionTuners group="D"`)을 모두 기본 카드로 승격하여 숨김 없이 한눈에 입력하도록 개선하고, `[⚙️ 상세 입력 옵션]` 토글은 진정한 고급 옵션인 **Step 2(연령대별 생활비 감액률 & 일시 목돈 이벤트)**와 **Step 9(부동산 전환 전략 & 국민연금 수령시기/추납)**에만 노출(`showDetailToggle = currentStep === 2 || currentStep === 9`).
- **항목 6-b & 7 — Step 6(`일반·법인 수익률`) 및 Step 7(`절세·연금 수익률`) 상호배타적 모드 탭 일원화 (`InputWizard.tsx`)**:
  - **Step 6 (`일반·법인 수익률`)**: 기본 카드 상단에 `[🎚️ 간편 슬라이더 입력]` vs `[🧩 ETF 포트폴리오 입력]` 2-탭을 배치하여, 선택된 탭의 UI(성장:배당 슬라이더+해외직투 비중 또는 `<EtfPortfolioBuilder scope="general" />`)만 카드 내부에 단독 노출.
  - **Step 7 (`절세·연금 수익률`)**: 1단계 상위 탭으로 **`[일반·법인 계좌 동일 적용 (IRP는 70% 위험자산 한도 자동 적용)]`** vs **`[절세·연금계좌 수익률 별도 적용]`**을 제공하고, 별도 적용 탭 선택 시 2단계 하위 탭(**`[🎚️ 간편 슬라이더 입력]`** vs **`[🧩 KRX ETF 포트폴리오 입력]`**)을 통해 계좌별 수익률 직접 입력과 `<EtfPortfolioBuilder scope="sheltered" />`를 메인 카드 안에서 깔끔하게 전환.
- **항목 8 — Step 10(`법인·배분전략`) 배분 방식 탭 분리 및 법인 전제조건 전면 배치 (`InputWizard.tsx`)**:
  - `[🤖 황금분할 최적해(r*) 자동 적용 (권장)]` 탭 활성 시에는 수동 `개인 : 법인` 비율 슬라이더를 숨기고 최적 배분 요약 배너만 표시하며, **`[🎚️ 개인 : 법인 비율 직접 지정]`** 탭을 선택했을 때만 수동 비율 슬라이더가 나타나도록 분리. 솔버(`r*`) 산출의 전제조건인 법인 임원 수·세율·유지비·청산 방식을 기본 카드 하단에 바로 배치.

---

## 13. v1.2.6 법인 손익분기·트라이모달 판정 동기화, 실질 구매력 생애 세금·건보 할인 통일, 인터랙티브 차트 범례 토글(Y축 자동 스케일링) 및 원장 상단 팝오버 개선 (Tab 3 추가 요청 항목 1~7 반영)
- **항목 1 — 법인 인출 우선순위 옵션 법률 기호 제거 (`PrecisionTuners.tsx`)**:
  - Step 10 및 정밀 설정 그룹 D의 `법인 인출 우선순위` 드롭다운에서 불필요한 법조문 기호 `(§17②3)`을 제거하여 `출자원금 비과세 선회수`로 직관화.
- **항목 2 — Step 11(`전체 입력 요약 확인 화면`) 배지 줄바꿈 방지 및 높이 통일 (`src/styles.css`)**:
  - `.wizard-summary-badges`, `.wizard-status-chip`(`맞춤 입력됨`/`기본 설정값`), `.wizard-edit-jump-btn`(`수정 ✎`)에 `display: inline-flex; align-items: center; height: 24px; white-space: nowrap; flex-shrink: 0;`을 적용하여 좁은 카드 폭에서도 글자가 두 줄로 꺾이지 않고 동일한 높이로 정렬되도록 개선.
- **항목 3 — `CORPORATE BREAK-EVEN DIAGNOSTIC`과 `TRI-MODAL STRATEGY COMPARISON` 판정 일관성 동기화 (`src/engine/optimizer.ts`, `Lens1AllocationTrack.tsx`)**:
  - 기존 단년도 정적 근사식 대신 51개년 정규 원장 시뮬레이션(`personal100`, `optimalHybrid`, `corporate100`) 실측 결과를 `evaluateCorporateBreakEven`에 직접 연동하여, `연간 지역건보료 방어 실익`과 `연간 배당·양도·과세이연 절세 실익`을 실제 시뮬레이션 델타에서 도출하고 황금분할 최적해(`r*`)에서 법인 배분이 유리할 때 손익분기 진단 배지도 일관되게 `✅ 법인 설립 손익분기 충족 — 최적 하이브리드(개인 X% : 법인 Y%) 권장`을 출력하도록 통합.
- **항목 4 — `TRI-MODAL STRATEGY COMPARISON` 생애 총 세금·건보·유지비 실질 구매력(`discountFactor`) 할인 기준 통일 (`src/engine/ledgerKernel.ts`)**:
  - `viewMode === 'real'`(현재 구매력 기준) 선택 시 기말 가처분 순자산·지속가능 월생활비와 동일하게 `totalLifetimeTaxPaid`, `totalLifetimeHealthInsPaid`, `totalLifetimeTaxAndHealthCost`, `totalLifetimeTaxAndHealthSaved`, `total30YearTaxAndHealthSaved`에 연차별 물가할인계수(`r.discountFactor = 1 / (1 + cpi)^t`)를 적용하여 51년 명목 인플레이션 착시를 제거하고 카드 내 화폐 단위를 100% 일원화.
- **항목 5 & 6 — 차트 범례 클릭 시리즈 토글(Show/Hide + Y축 동적 재스케일링) 및 `Lens 1` 궤적 중첩 가시성 개선 (`Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`, `src/styles.css`)**:
  - `Lens 1`(생애 순자산 궤적 차트) 및 `Lens 2`(5대 계좌 적층 잔액 차트 & 8단계 인출 원천 차트)의 모든 범례를 클릭 가능한 토글 버튼(`.legend-item-btn`, 비활성 시 `.legend-item-muted` 취소선 + `[전체 표시]` 리셋 버튼)으로 전환하고, 큰 비중 항목(가족법인, 일반계좌 등)을 숨기면 나머지 소액 계좌(IRP·ISA·연금저축 등)에 맞춰 **Y축 최대값(`maxTrajVal`, `maxStackVal`, `maxCashflowVal`)이 자동으로 확대 재스케일링**되도록 구현.
  - `Lens 1` 생애 순자산 궤적 차트에서 최적해가 법인 99%(`optimalHybrid`)일 때 보라색 점선(`corporate100`)이 파란 실선 아래에 가려지던 렌더링 순서를 교정하여, 보라색 대시 라인(`strokeDasharray="6 5"`)을 파란 실선 위에 렌더링함으로써 두 궤적이 겹치는 구간에서도 파란-보라 교차선으로 두 전략의 동조 궤적이 선명하게 식별되도록 개선.
- **항목 7 — 51개년 원장 테이블 상단 행(50~55세 등) `ⓘ` 영수증 팝오버 상단 잘림 해결 (`Lens2WaterfallLedger.tsx`, `src/styles.css`)**:
  - `.ledger-table-scroll`(`overflow: auto`) 컨테이너 최상단 3개 행(`rowIdx < 3`)에 `.ledger-row-top-popover` 클래스를 부여하여 해당 행의 `.ledger-why-popover`가 위쪽(`bottom: calc(100% + 6px)`)이 아닌 **아래쪽(`top: calc(100% + 6px); bottom: auto; transform-origin: top right;`)**으로 열리도록 분기함으로써 테이블 헤더 및 스크롤 컨테이너에 의한 상단 클리핑을 완벽히 해결.

---

## 14. v1.2.7 2-모드 워크플로우 일원화 (`① 조건 입력 위저드` ↔ `② 금융자산 구성 가이드 & 상세 분석`) 및 레거시 전문가 통합 뷰 제거 (Option A)
- **상단 2-모드 네비게이션 일원화 (`src/App.tsx`)**:
  - `InputWizard`(1~10단계 + Step 11 전체 입력 요약 & `[수정 ✎]` 원클릭 점프)와 `ActionGuideView`(`VerdictHeader` + 3단계 실행 공식 + `Lens 1~3` 전체 분석 + `📌 현재 결과 기준안(A) 고정` A/B 비교)가 기존 `⚡ 전문가 통합 뷰`(`workbench`)의 모든 기능을 100% 포괄함에 따라, 상단 모드를 **`① 조건 입력 (단계별 위저드)`** ↔ **`② 금융자산 구성 가이드 & 상세 분석`** 2-모드로 일원화하여 사용자 동선을 단순화.
- **레거시 `<ControlDock />` 중복 UI 약 1,240줄 제거 및 공통 프리미티브 모듈화 (`src/components/ControlDock.tsx`)**:
  - 위저드(`InputWizard.tsx`)와 100% 중복되던 레거시 좌측 컨트롤 도크 컴포넌트(`ControlDock`, ~1,158줄)와 `App.tsx`의 `workbench-grid` 분기(~90줄)를 제거하여 이중 유지보수 부담과 UI 드리프트(Drift) 위험을 원천 차단하고, 공통 프리미티브(`resolveNumericDraft`, `NumericInput`, `FIELD_HELP_CATALOG`, `FieldHelpBadge`, 298줄)만 깔끔하게 보존.

---

## 15. v1.2.8 실질 가치 중심 UX 휴리스틱 개선 (상태 보존 · 빠른 점프 · 오표기 교정 · 키보드 접근성)
- **모드·탭 전환 시 상태 유실 방지 및 컨텍스트 원클릭 점프 (`src/App.tsx`, `src/components/InputWizard.tsx`, `src/components/ActionGuideView.tsx`)**:
  - `wizardStep`(`1~11`)과 `selectedTile`(`tile1~tile4`) 상태를 `App.tsx`에서 유지하여, 시나리오 A/B 비교나 조건 재조정을 위해 `① 위저드 ↔ ② 가이드`를 오갈 때 직전에 보던 위저드 단계와 분석 탭(`분석 03` 등)이 `Step 1`이나 `분석 01`로 초기화되지 않고 그대로 보존되도록 개선.
  - `ActionGuideView` 상단 요약 컨텍스트(`현재 50세 → 60세 은퇴` · `목표 월생활비 500만원` · `일반자산 10억`) 클릭 시 각각 위저드 `Step 1`, `Step 2`, `Step 3`으로 즉시 점프(`onJumpToWizardStep`)할 수 있도록 연결하고, `InputWizard`의 `Step 11(전체 요약)`에서 `[수정 ✎]`을 눌러 특정 단계로 이동한 경우 하단 푸터에 `[📋 요약 화면으로 돌아가기]` 빠른 복귀 버튼을 제공.
- **오표기 문구 교정 및 체크리스트 `localStorage` 보존 (`src/components/InputWizard.tsx`, `src/components/Lens3StrategyMatrix.tsx`)**:
  - `InputWizard.tsx`: Step 1~10 카드 상단 안내 문구를 `summaryItems[currentStep - 1]?.isDefault`와 연동하여 값 수정 시 `"맞춤 입력값이 적용되어 있습니다"`로 동적 전환.
  - `Lens3StrategyMatrix.tsx`: `v1.2.7`에서 제거된 `"좌측 도크"` 참조 문구 및 잔존 `(§17②3)` 표기를 정정하고, `분석 03` 실행 체크리스트 체크 상태를 `localStorage`(`retire_opt_checklist_v1`)에 유지하여 분석 탭 전환 시 초기화되지 않도록 개선.
- **전략 비교 행 키보드 접근성 보강 (`src/components/Lens3StrategyMatrix.tsx`)**:
  - 국민연금 개시 시기(3종) 및 법인 임원 수(2종) 선택 행(`.sub-option-row`)에 `role="button"`, `tabIndex={0}`, `aria-pressed`, `Enter/Space` 키보드 핸들러 및 `"항목 클릭 시 시뮬레이션에 즉시 반영"` 캡션 추가.

---

## 16. v1.2.9 단계별 핵심 결과 브리핑 슬라이드(6단계 집중 카드) & 3단계 상단 네비게이션 하이브리드 아키텍처 (Option A + Option B)
- **상단 3단계 순차 네비게이션 분리 (`src/App.tsx`)**:
  - 초심자의 인지 과부하를 해소하고 숙련자의 심층 분석 접근성을 동시에 보장하기 위해 상단 모드를 **`① 조건 입력 (단계별 위저드)`** ➔ **`② 핵심 결과 브리핑 (단계별 슬라이드)`** ➔ **`③ 상세 분석 & 원장`** 3단계 흐름으로 분리.
  - 입력 위저드 완료 시 `② 핵심 결과 브리핑 (단계별 슬라이드)`의 첫 번째 슬라이드(`결과 1. 종합 판정`)로 진입하며, `briefingStep`(`1~6`) 상태를 `App.tsx`에서 보존.
- **6단계 1-Card-at-a-Time 핵심 결과 브리핑 덱 (`src/components/ActionGuideView.tsx`, `BRIEFING_SLIDES`)**:
  - 입력 위저드(`.wizard-stepper-bar`, `.wizard-focus-card`)와 동일한 카드 프레임·진행률 바·이전/다음 푸터를 재사용하여 한 화면에 하나의 핵심 결론만 순차적으로 제시:
    1. **`결과 1. 종합 판정`**: 한 줄 최종 판정 배너 + 4대 핵심 KPI(`VerdictHeader`) + 연령대별(`은퇴 D-Day · 65세 · 75세 · 85세 · 100세`) 예상 세후 순자산 요약 스트립(`.briefing-milestone-strip`).
    2. **`결과 2. 은퇴 전 적립 공식`**: `STEP 01` 연간 절세계좌 우선 적립 및 초과 저축분 개인:법인 분할 공식 카드 (`renderStep1Card()` 공유).
    3. **`결과 3. 은퇴 D-Day 5대 계좌`**: `STEP 02` 은퇴 당일 5대 금융계좌(`IRP · ISA · 연금저축 · 일반과세 · 가족법인`) 최적 배치 비중 바 및 적립 브릿지 카드 (`renderStep2DdayBox()` 공유).
    4. **`결과 4. 은퇴 후 월 인출 순서`**: `STEP 03` 은퇴 후 3순위 절세 인출 공식 카드 (`renderStep3Card()` 공유).
    5. **`결과 5. 개인 vs 법인 절세 실익`**: 3대 전략(`개인 100%` vs `최적 하이브리드 r*` vs `법인 100%`) 비교 스코어보드 및 법인 설립 손익분기 진단 요약 카드.
    6. **`결과 6. 실행 체크리스트 & 요약`**: 국민연금 최적 수령 시기 · 법인 임원/출구전략 요약 카드 및 `localStorage`(`retire_opt_checklist_v1`) 실시간 연동 인터랙티브 실행 체크리스트.
- **각 브리핑 슬라이드에서 심층 차트·원장으로 1-Click 점프 (`onJumpToAnalyticsTile`)**:
  - 모든 브리핑 슬라이드 우측 상단 및 하단 액션 바(`.briefing-deepdive-bar`)에 **`[📊 이 슬라이드의 심층 차트·원장 바로 보기]`** 버튼을 배치하여, 클릭 즉시 `③ 상세 분석 & 원장` 모드의 해당 분석 타일(`tile1`~`tile4`)로 전환 및 스크롤 이동.
  - `③ 상세 분석 & 원장` 모드에서는 상단 3단계 실행 공식 & D-Day 5대 계좌 배치표를 접이식 토글(`[📌 3단계 실행 공식 & 은퇴 D-Day 5대 계좌 최종 배치표 한눈에 보기]`)로 제공하여, 브리핑 슬라이드에서 차트 타일로 점프했을 때 스크롤 없이 차트가 화면 최상단에 즉시 노출되도록 최적화(`isPrintMode` PDF 인쇄 시에는 전체 자동 전개).

---

## 17. v1.2.10 CFP/PB 은퇴·세무 전문가 리뷰 반영 5대 개선 (수치 1원 정합성 · 99:1 실무 통합 권고 · 배우자 IRP 10년 균등수령 · 상증세법 리스크 고지 · 하방 민감도 전면 노출)
- **Task 1 — 리포트 페이지 간 3대 수치 불일치 1원 단위 일치 (`ActionGuideView.tsx`, `Lens2WaterfallLedger.tsx`, `optimizer.ts`)**:
  - `STEP 01` 예상 퇴직금 안내 문구에 본인+배우자 합산(`totalSeveranceGross`) 및 `(본인 X + 배우자 Y)` 병기를 적용해 `STEP 02` D-Day 브릿지의 `퇴직금이체` 금액과 1원 단위 일치.
  - 51개년 원장(`Lens2WaterfallLedger.tsx`) 은퇴 전환 행(`53세`)의 `퇴직금` 유입 칩에 실질 구매력(`isReal`) 모드 시 `(명목 1.9억)`을 병기하여 CPI 할인 실질가치(`1.76억`)와 명목 퇴직금 원금 간 차이를 투명하게 안내.
  - `buildPensionOption`(`optimizer.ts`)의 `monthlyPayoutInitial` 및 `cumulativePayoutTo100`에 `isRealView ? r.discountFactor : 1`을 적용하여 `분석 03` 국민연금 테이블과 상단 요약 카드의 실질 구매력 수치를 1원 단위로 동기화.
- **Task 2 — `개인 1% : 법인 99%` 미세 분할 실무 통합 가이드 및 비교 기준선 명확화 (`VerdictHeader.tsx`, `ActionGuideView.tsx`)**:
  - 상단 배지(`VerdictHeader.tsx`)의 모호한 `"단독 운용 대비 +499만원 우위"` 문구를 **`개인 단독 운용(100%) 대비 세후 +15.5억 우위`**로 명확히 표시하고, `1% <= personalRatio <= 5%`이면서 법인 100% 대비 50년 누적 실익이 0.5%(또는 1,000만 원) 미만인 경우 **`실무상 법인 100% 통합 권장 (차이 +499만)`** 안내를 병기.
  - 브리핑 `결과 5` 슬라이드(`ActionGuideView.tsx`)의 `OPTIMAL` 하이라이트 조건을 `c.strategyType === plan.winner`로 동기화.
- **Task 3 — 배우자 지분 IRP 24년 인출 공백 버그 수정 및 퇴직금 원금 10년 균등 연금수령한도 반영 (`ledgerKernel.ts`, `ActionGuideView.tsx`)**:
  - `ledgerKernel.ts` Stage `⑤-2` 및 `hhPensionTax`에서 본인 연금저축 인출(`1,500만`)로 `remSelfRoom === 0`이 될 때 배우자 지분(`iSpouseShare > 0`)의 미사용 저율과세 한도(`remSpouseRoom = 1,500만`)까지 동시 잠기던 수식을 교정하여, 60~83세 24년간 IRP 인출이 0원으로 멈추던 현상을 해소.
  - IRP 내 이연퇴직소득 원금(`irpDeferredRemaining`)에 소득세법 시행령 제40조의2 연금수령한도(개시 후 1~10년차 10년 균등배분 페이싱)를 적용하고, Stage `⑧` 비상 인출 시에도 연금 개시연령(`personalPensionStartAge`, `irpStartAge`)을 준수하도록 보강.
- **Task 4 — 가족법인 세무 실사 리스크(인건비 부인·상증세법 제45조의5) 고지 및 `가업승계` 용어 교정 (`optimizer.ts`, `Lens3StrategyMatrix.tsx`, `Lens2WaterfallLedger.tsx`)**:
  - 금융투자 법인이 상증세법상 가업상속공제·가업승계 과세특례 대상에서 제외됨을 반영해 출구전략 명칭을 **`자녀 지분 참여 · 가족법인 지분승계`**로 바로잡고, 무이자 가수금 대여에 따른 **상증세법 제45조의5(특정법인과의 거래를 통한 이익의 증여 의제)** 검토 주의사항과 비상근 임원 가공 인건비 부인 방지를 위한 실질 업무 증빙(`정관 보수규정 · 주총 결의서 · 월별 자산운용 리포트`) 요건을 명시.
  - 51개년 원장(`Lens2WaterfallLedger.tsx`) 우측 기말 컬럼 헤더를 `기말 5대 계좌 장부잔액` vs `기말 세후 가처분 순자산 (청산세 차감)`으로 구분하고, 가처분 순자산 셀 하단에 `장부 X − 청산세 Y` 서브텍스트를 노출.
- **Task 5 — 브리핑 첫 화면 및 PDF 출력 시 하방 수익률 민감도(`-2.0%p · P10`) 및 후기 노년 간병비 버퍼 상시 노출 (`ActionGuideView.tsx`, `Lens1AllocationTrack.tsx`)**:
  - 브리핑 `결과 1. 종합 판정` 슬라이드 하단에 **하방 리스크 & 간병비 버퍼 3열 요약 스트립**(`-2.0%p 보수적 시나리오 100세 순자산`, `몬테카를로 하위 10%(P10) · 100세 생존확률`, `후기 노년 케어·간병비 가용 월 여유분`)을 신설하고, PDF 마스터플랜 출력(`isPrintMode`) 시 `Lens 1` 수익률 민감도 밴드가 기본 활성화(`defaultShowSensitivityBand={isPrintMode}`)되도록 개선.

---

## 18. v1.2.11 PDF 리포트 버튼 단일화 & PB·자산 컨설팅 펌 수준의 4-Part 마스터플랜 PDF 리포트 개편 (`핵심 결과 브리핑 1~6` + `상세 분석 01~04` 완전 통합)
- **Task 1 — 중복된 PDF 리포트 출력 버튼 단일화 (`src/App.tsx`, `src/components/ActionGuideView.tsx`)**:
  - `ActionGuideView.tsx` 우측 상단 서브 바(`.guide-top-right`)에 중복 노출되던 `🖨️ PDF 마스터플랜 리포트 출력` 버튼을 제거하고, 상단 글로벌 헤더(`src/App.tsx`)의 **`🖨️ PDF 마스터플랜 리포트`** 단일 버튼으로 통합하여 3대 모드(`① 조건 입력`, `② 핵심 결과 브리핑`, `③ 상세 분석 & 원장`) 어디서나 중복 없이 원클릭 출력되도록 일원화.
- **Task 2 — PB·자산 컨설팅 펌 수준의 4-Part 마스터플랜 PDF 리포트 (`.print-masterplan-report`, `ActionGuideView.tsx`, `src/styles.css`)**:
  - **표지 마스트헤드 & `PART I` (`핵심 결과 브리핑 슬라이드 1~4` + `10대 고객 설계 전제조건 명세표`)**:
    - 다크 네이비/로열 블루 기관용 마스트헤드(`.print-report-masthead`), `1-WON EXACT VERIFIED` 회계 검증 스탬프, 4대 요약 메타데이터 바.
    - **`PART I-1` (10대 고객 설계 전제조건 명세표, `.print-assumptions-grid`)**: 위저드 1~10단계 전제조건을 5열×2행 컨설팅 그리드로 수록.
    - **`PART I-2` (브리핑 슬라이드 01 통합)**: 종합 판정 배너 + `VerdictHeader` + 5대 연령(`은퇴 D-Day · 65세 · 75세 · 85세 · 100세`) 예상 세후 순자산 마일스톤 스트립 + 하방 스트레스(`-2.0%p · P10 생존확률`) & 후기 노년 케어·간병비 월 여유분 3열 스트립.
    - **`PART I-3` (브리핑 슬라이드 02~04 통합)**: 단계별 핵심 적립·인출 요약 KPI 스트립 + `STEP 01(은퇴 전 적립 공식)` + `STEP 03(은퇴 후 월별 인출 순서)` + `STEP 02(은퇴 D-Day 5대 금융계좌 최종 배치표 & 적립 브릿지)`.
  - **`PART II` (`상세 분석 01 · Lens 1 전체`, `.print-page-break`)**: 개인 vs 법인 황금분할($r^*$) 효율 곡선 + 수익률 민감도 밴드(`±2.0%p · P10~P90`)가 자동 활성화된 100세 순자산 궤적 차트 + 연간 절세·건보료 방어 실익 차트.
  - **`PART III` (`브리핑 슬라이드 05~06 + 상세 분석 02~03 통합`, `.print-page-break`)**: 5대 계좌 적층 잔고 및 8단계 인출 워터폴 차트(`Lens 2` 차트) + 3대 전략 비교 스코어보드·손익분기 판정·국민연금 수령 시기 비교표·가족법인 임원/출구전략(상증세법 제45조의5 고지 포함)·생애 실행 체크리스트(`Lens 3`).
  - **`PART IV` (`상세 분석 04 · 51개년 전체 원장 표 + 세무·법무 유의사항 푸터`, `.print-page-break`)**: 페이지별 헤더 자동 반복(`thead { display: table-header-group }`) 및 행 잘림 방지(`tr { break-inside: avoid }`)가 적용된 51개년 전체 원장 명세표 + 3열 세무·법무·회계 검증 고지 푸터(`.print-report-footer`).

---

## 19. v1.2.12 2026 세법·건보 정밀도 고도화 및 무클러터(Zero-Clutter) 인라인 진단 & 통합 마스터플랜 CSV 내보내기
- **P0 — 2026 최신 한국 세법·건보공단 부과 기준 4대 정밀 보강 (`src/engine/taxAndHealth.ts`, `src/engine/pensionAndEtf.ts`, `src/engine/ledgerKernel.ts`)**:
  - **2026.06.17 국민연금 소득활동 노령연금 감액 개편 반영 (`calculatePublicPensionWorkReduction`)**: 현행 `A값(3,193,511원) + 200만 원 = 월 5,193,511원` 미만 근로·사업소득에 대한 노령연금 감액 폐지 및 초과 구간 단계별(5~25%, 최대 50% 상한) 감액 로직 구현.
  - **법인 과세배당 10% Gross-Up 및 배당세액공제 (`소득세법 §17③·§56`, `calculateIndividualCombinedTax`)**: 2,000만 원 초과 종합과세 대상 법인 배당분(`eligibleGrossUpDividend`)에 대해 10% 배당가산액 합산 후 산출세액에서 동일 금액을 배당세액공제로 차감하고 15.4% 원천징수 비교과세 하한(`소득세법 §62`)을 보장.
  - **지역건보 금융소득 1,000만 원 절벽 & 피부양자 3단계 판정 (`국민건강보험법 시행령 §41·시행규칙 §2`, `calculateRegionalHealthInsurance`)**: 연 1,000만 원 이하 이자·배당소득의 지역건보 소득보험료 과표 제외 절벽(`HEALTH_INSURANCE_FINANCIAL_INCOME_CLIFF`)과 재산과표 구간별(`≤5.4억` 연 2,000만 / `5.4억~9억` 연 1,000만 / `>9억` 즉시 탈락) 피부양자 판정 및 잔여 소득 여유 한도(`dependentIncomeHeadroom`) 산출.
  - **IRP 연금수령 11년차 이후 퇴직소득세 40% 감면율 전환 및 ISA 생애 누적 비과세 한도 추적 (`ledgerKernel.ts`)**: IRP 연금개시 연차(`irpAnnuityYear = ageSelf - irpStartAge + 1`) 기준 11년차부터 감면세율을 30%(`×0.70`)에서 40%(`×0.60`)로 정확히 전환하고, ISA 인출 시 가구 합산 비과세 한도(`isaRemainingExemptGain`)를 생애 누적 차감 후 초과분에 9.9% 분리과세 적용.
- **P1 — 국내상장 커버드콜·해외지수 ETF 과표배당 비중(`taxableDividendRatio`) 및 매매차익 배당소득세(`krxTaxableGainRatio`) 반영 (`src/engine/pensionAndEtf.ts`, `src/engine/ledgerKernel.ts`)**:
  - 상세 ETF 포트폴리오 모드에서 국내상장 커버드콜 ETF의 옵션 프리미엄 비과세 분배금 특성을 반영한 가중 과표배당 비중(`taxableDividendRatio`)과 일반계좌 내 국내상장 기타 ETF 매매차익 15.4% 배당소득세(`krxTaxableGainRatio`)를 `accountingResidual === 0원` 보존 항등식 내에서 정밀 정산.
- **P2 & P3 — UI 복잡도 증가 없는(Zero-Clutter) 인라인 진단 & 다중 섹션 통합 마스터플랜 CSV 내보내기 (`Lens3StrategyMatrix.tsx`, `Lens2WaterfallLedger.tsx`, `optimizer.ts`)**:
  - 새로운 탭이나 위저드 단계를 추가하지 않고, `분석 03` 국민연금 수령 시기 비교 행에 **정상수령 대비 누적 수령액 손익분기 교차 연령(`정상수령 누적교차 X세`)**을 인라인 표기.
  - `분석 04` 51개년 원장의 세금·건보 호버 팝오버(`.ledger-why-popover`) 내에 연차별 **세법·건보 절벽 여유 한도(`피부양자 소득 여유` · `사적연금 저율한도 여유`)**를 인라인 노출하고, 원장 툴바에 4대 섹션(전략 비교 요약 · D-Day 5대 바스켓 청사진 · 국민연금 손익분기 비교 · 51개년 원장)을 한 파일로 내려받는 **`[통합 마스터플랜 CSV]`** 버튼을 병치.

---

## 20. v1.2.13 케어기(78세+) 간병·의료비 미반영 버그 수정 & CFP/PB 20페이지 리포트 리뷰 4대 개선
- **Item 0 — 케어기(78세+) 월 간병·의료 추가비 미반영(Ghost Display) 버그 수정 (`src/engine/types.ts`, `src/components/PrecisionTuners.tsx`, `src/components/InputWizard.tsx`, `src/components/ActionGuideView.tsx`)**:
  - `DEFAULT_ACTIVE_SENIOR_CONFIG`에서 `careShockMonthlyExpense: 1_500_000`(150만 원)이 설정되어 있음에도 `applyCareShock: false`로 초기화되어 화면 입력창에는 `150만원`이 표시되면서 실제 `getMonthlyLivingExpenseForAge` 계산에서는 누락되던 불일치를 해결.
  - `normalizeCashflow` 및 `getMonthlyLivingExpenseForAge`가 `careShockMonthlyExpense > 0` 여부를 직접 반영하도록 일원화하고, 위저드 요약 및 PDF `STEP 02` 전제조건 카드에 `(케어기 간병비 +N만)`을 명시.
- **Task 1 — 몬테카를로 생존확률 표본수(`sampleCount = 40`) 단일화 및 원장 `법인세` / `세금(법인포함)` 분리 표기 (`ActionGuideView.tsx`, `Lens2WaterfallLedger.tsx`)**:
  - `ActionGuideView.tsx` Slide 1(`PART I-2`)과 `Lens1AllocationTrack.tsx`(`PART II`)의 `evaluateSensitivityBand` 표본수를 기본값 `40`으로 통일하여 페이지 간 P10 생존확률(`78%`)이 100% 일치하도록 정렬.
  - 51개년 원장의 `세금·건보·유지비` 인라인 분해 칩에서 법인 운용수익에 대한 법인세만 발생한 경우 `법인세`, 개인세금과 법인세가 함께 발생한 경우 `세금(법인포함)`, 개인세금만 발생한 경우 `개인세금`으로 구분 표기하고 상단 각주를 추가하여 가수금 비과세 반제와의 혼선을 제거.
- **Task 2 — PDF 리포트 4대 인쇄 레이아웃 정밀 교정 (`ActionGuideView.tsx`, `Lens2WaterfallLedger.tsx`, `Lens3StrategyMatrix.tsx`, `src/styles.css`)**:
  - `PART III`의 `Lens2WaterfallLedger` 호출 시 `hideBlueprintCard`를 전달하여 `PART I-3`와 중복 출력되던 5대 계좌 배치 카드를 제거.
  - `@media print`에서 `.playbook-dday-box` 및 `.plan-b-advisory-box`에 `break-inside: avoid`를 적용하고, 스냅샷 미지정 시 빈 A/B 안내 배너 카드(`.ab-empty-card`)를 인쇄에서 숨김 처리.
  - 51개년 원장 섹션(`.canvas-card-ledger`)에 `break-inside: auto !important` 및 `.ledger-table` 인쇄 규칙을 적용하여 `PART IV` 헤더 페이지 하단 90%가 공백으로 남던 현상을 해소.
- **Task 3 — 손익분기 저마진 구간 행정비용 트레이드오프 고지 및 연기연금 기회비용 해설 (`src/engine/optimizer.ts`, `Lens3StrategyMatrix.tsx`)**:
  - `evaluateCorporateBreakEven`에서 연간 정적 순실익(`netAnnualAdvantage`)이 1,000만 원 미만일 때 초기 정적 실익 대비 48년 과세이연 복리 효과와 법인 기장·상근 소명 등 행정 번거로움을 비교 안내하는 문구를 추가.
  - `Lens3StrategyMatrix.tsx` 국민연금 카드에 연기수령(`+36%`, 연 7.2% 단리 증액, 단리 누적교차 79세)보다 정상수령(65세)의 100세 가처분 순자산이 더 높게 산출되는 이유(65~69세 5년간 절세계좌·법인가수금 원금 선인출에 따른 35년 복리 투자수익 상실 및 과세로 새는 비용)를 명시.
- **Task 4 — 하방 리스크 및 후기 간병비 안전마진 부족 시 Plan B 컨틴전시 가이드 자동 노출 (`ActionGuideView.tsx`, `src/styles.css`)**:
  - P10 생존확률이 90% 미만이거나 한계생활비 월 여유분이 100만 원 미만일 때, Slide 1 및 PDF `PART I-2` 하단에 **① 거주주택 후기 유동화(공시가 12억 초과 시 HF 주택연금 제한 및 다운사이징 대안 안내) · ② 은퇴 시점 1~2년 연장/반퇴 · ③ 하락장 가변 인출 가드레일**을 제시하는 `.plan-b-advisory-box` 콜아웃을 자동 표시.

---

## 21. v1.2.14 Tab 3 확인·수정 요청 반영 (사이클 1: 원장 외부유입 팝오버 · 워터폴 이중 적층/Y축 · 용어 정리 / 사이클 2: 현재가치·물가 표기 · 수익률 시나리오 · 민감도 밴드 교정)
- **T1 [P0] — 원장 `외부유입` 칸 빈 팝오버 버그 수정 (`Lens2WaterfallLedger.tsx`)**:
  - `td.ledger-has-popover`만 있고 `.ledger-why-popover` 자식이 없어 커서만 `?`로 바뀌던 문제를 해결. 기존 팝오버 마크업을 재사용해 재직 중 저축(ISA·연금저축 한도 우선 → 개인:법인 비율 적립) · D-Day 퇴직금(세전, 사용자가 고른 경로대로 `IRP 이전 → 과세이연` 또는 `일시수령 → 퇴직소득세는 세금 열 계상`) · 국민연금 · 주택연금 · 부동산 다운사이징 차액 · 목돈 이벤트를 연차별로 표시하고, 투자수익은 별도 열임을 명시.
  - 팝오버 셀 3곳에 `tabIndex={0}`을 부여해 기존 `:focus-within` 규칙으로 키보드에서도 열림.
- **T2' [P1] — 8단계 워터폴 이중 적층 및 범례 Y축 재조정 수정 (`Lens2WaterfallLedger.tsx`)**:
  - Y축 스케일 계산이 범례·막대와 다른 키(`stage1`…`friction`)를 써서 범례를 꺼도 Y축이 다시 맞춰지지 않던 버그를 `s1`…`s67`·`tax`로 통일해 해결.
  - 빨간 막대를 `outsideCost(r)` = `max(법인세+4대보험+유지비, 생활비 + 총유출 − 미충당 − 조달 막대 합계)`로 변경(D4). 조달 막대(①~⑦)는 개인세·건보·추납을 이미 Gross-Up해 포함하므로, 빨간 막대에는 계좌 밖 비용(법인 비용 · D-Day 일시퇴직세 · 일반계좌 직차감 추납)만 남아 재직 중 배당세가 두 번 쌓이지 않음. 범례는 `법인세·4대보험·유지비 등 (계좌 밖 비용)`, 헤더 pill은 총액 유지.
  - 재직 중(목돈 지출 없음) 일반계좌 인출 칩·툴팁·팝오버를 `배당세 원천징수`로 표기(일반계좌 분배금에서 낸 배당소득세 = 세금 열의 개인세와 같은 돈).
  - 한계: 연금·급여 잉여(재투자) 연도와 인출 Gross-Up 과다분이 일반계좌로 환입되는 연도는 막대 합계가 실제 유출보다 클 수 있으며, 이때 빨간 막대는 과다분만큼 작게(최소 법인 비용) 표시.
  - 호버 툴팁 상자를 284→340px로 넓히면서, 왼쪽으로 뒤집힐 때 Y축 라벨 영역까지 허용해 커서 막대를 덮지 않도록 조정.
- **T3 [P1] — 금융권 직역어(friction) 표기를 `세금·건보·유지비` / `새는 비용`으로 교체 (`Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`, `Lens3StrategyMatrix.tsx`, `ActionGuideView.tsx`, `optimizer.ts`, `FEATURES.md`)**:
  - 출구전략 카드 `실효 세부담`, 손익분기 박스 `연간 법인 기장·4대보험 고정비` 등 화면 문구 16줄과 본 문서 5곳을 정리.
  - 원장 각주와 워터폴 pill에 `국민연금 추납 납입액 포함`을 명시(`totalTaxHealthAndFees`에 세금이 아닌 `additionalPensionContribution`이 합산됨).
- **테스트 (`test/uiParity.test.ts` §27~29)**: 팝오버 셀 수 == 팝오버 본문 수, 워터폴 범례 키가 스케일·막대에 정확히 2회씩 사용, 6개 시나리오 × 4개 원장 1,224개 연차에서 `outsideCost`가 법인 비용 이상 · 유출 은닉 없음 · 조달 막대 내 비용 재계상 없음, 기본 입력 90세 막대 총높이 = 생활비 + 총유출(1원 일치), 재직 50세 배당세 1회 적층, 프리셋이 만들지 않는 D-Day 일시퇴직세·일반계좌 직차감 추납이 빨간 막대에 들어가는지(별도 시나리오), 화면 문구 5개 파일 내 해당 용어 0건.

### 사이클 2: 현재가치·물가 표기 · 수익률 시나리오 선택기 · 민감도 밴드 ±2.0%p 교정
- **T4 [P1] — 현재가치·물가 표기 (`InputWizard.tsx`, `PrecisionTuners.tsx`, `ControlDock.tsx`, `Lens2WaterfallLedger.tsx`)**:
  - 목표 생활비·케어기 간병비·국민연금은 **현재가치**로 입력하고 엔진이 현재 나이(0년차)부터 물가를 복리로 붙인다는 사실을 화면에 표기. Step 2에 `은퇴 첫해(60세) 약 월 640만 원 · 물가 2.5% 반영 (명목)` 줄을 추가(`목표 × (1+물가)^(은퇴−현재 나이)`, 기본 입력 500만 → 640만). 엔진과 같은 `getMonthlyLivingExpenseForAge` 지출 곡선을 거치므로 액티브 시니어 모드(은퇴 나이 ≤ 액티브기 종료)에서는 +25%가 반영됨(같은 입력 800만).
  - 국민연금 입력 라벨에 `· 현재가치`, 간병비 라벨에 `(현재가치 · {현재 나이}세부터 물가연동)`을 추가.
  - 법인 유지비 도움말을 엔진 동작(명목 고정)에 맞춰 `입력한 금액(명목, 물가 미연동)이 매년 법인 계좌에서 차감`으로 수정(D1-B). 엔진 물가 연동(D1-A)은 `45→50` 프리셋 판정을 바꾸므로 별도 계획으로 분리.
  - 워터폴·원장 제목에 `실질·현재가치` / `명목` 태그 추가(바스켓 차트와 같은 방식).
- **T5 [P2] — 수익률 시나리오 선택기 + 민감도 밴드 교정 (`types.ts`, `ledgerKernel.ts`, `sensitivityBand.ts`, `optimizer.ts`, `InputWizard.tsx`, `ActionGuideView.tsx`)**:
  - `BasicAssetInputs.returnShiftPct`(%p, 기본 0) 추가. 커널 한 곳에서만 가산: 일반·법인 성장률(→ 대칭 모드 ISA·연금저축·IRP 수익률)과 Step 7 계좌별 지정 수익률. 배당수익률은 그대로라 분배금 과세 기반은 변하지 않음. 은퇴 직후 시장 스트레스 시나리오의 고정 하락 경로 연차에는 시프트를 더하지 않음(기존 밴드와 동일).
  - Step 6에 `낮게 −3%p | 기본 | 높게 +3%p` 3버튼(간편·ETF 모드 공통, 기존 `.wizard-return-mode-tab` 재사용, 라벨은 운용보수와 혼동되는 "보수" 대신 D2안). Step 6 요약은 시프트 선택 시 `시나리오 ±3%p`를 표시하고 기본값 판정에서 제외, PDF `PART I-1` STEP 06은 시프트 반영 수익률과 선택 시나리오를 표기. Step 6 대표 수익률(hero)에도 시프트 선택 시 `→ 시나리오 적용 연 X%`를 병기.
  - 시프트 표시 정합성: Step 7 요약·대표 수익률(hero), 실행 가이드 STEP 01 ③ 가중평균 기대수익률에도 같은 `→ 시나리오 적용` 값을 병기하고, PDF `PART I-1` STEP 07 계좌별 수익률은 엔진 값(입력 + 시프트, 소수 2자리)으로 표기. STEP 07의 폴백 기본값(7 / 6.5 / 5.6%)을 커널과 같은 5.4%(IRP는 연금저축 → 5.4%)로 맞춤.
  - **민감도 밴드 버그 수정(D3)**: `shiftInputsReturn`이 `growthRate`만 옮겨 간편 모드에서 성장 비중 70%로 가중(±1.4%p)되던 문제를 `returnShiftPct` 누적으로 교체 → 간편·ETF 모드 모두 정확히 ±2.0%p(기본 입력 5.40% → 3.40%). 사용자가 고른 시나리오 위에 누적(−3%p 선택 시 밴드 하단 −5%p). 기본 프리셋(r*=8%) −2%p 100세 실질 순자산 **12.24억 → 6.76억**, +2%p 80.69억 → 112.52억, P10 8.18억 → 2.75억, 생존확률 100% → 95%.
  - 법인 손익분기 임계 자산(`evaluateCorporateBreakEven`의 기대수익률)도 시프트를 반영.
  - 선택기가 판정을 바꾸는 예: −3%p에서 `40→45` 67세·`45→50` 77세·`55→60` 100세 고갈, +3%p에서 `45→50` 최적안이 법인 100%.
- **테스트**: `ledgerInvariants` §12 — 5대 계좌를 하나씩 1억으로 채운 격리 시나리오(대칭/계좌별 지정 모드 각각)에서 시프트 −3/+3 시 1년차 투자수익이 정확히 ∓300만(±1원) 이동, 5개 프리셋 × 시프트 ±3 × 비율 3종 전 연차 잔차 0원(총 4,001개 연차). `optimizer` §7-a — 간편 모드 기본 입력 −2%p 밴드 실효 수익률 3.40%, 시나리오 누적(−3 → −5), 밴드 −2%p 100세 순자산 = 커널 시프트 −2 원장(1원 일치), 일반계좌 1억 격리 입력에서 커널 밴드 −2%p 1년차 투자수익 = 정확히 340만. `uiParity` §30~31 — T4 표기·도움말·제목 태그, Step 2 pill이 엔진 지출 곡선을 쓰는지(정액·액티브 시니어 모드 각각 엔진 첫해 생활비와 1원 일치), T5 선택기·`isDefault`·PDF·hero 시나리오 병기·밴드 누적·기존 `evaluateSensitivityBand(inputs, activeLedger.personalRatio, 40)` 계약 유지.

### 사이클 3: 국민연금 보험료율 연차별 인상 · 원장 개인/법인세 인라인 병기 · 국내지수 ETF(`KR_INDEX`) 비과세 및 카탈로그 보정 · 은퇴 D-Day 법인 설립·일괄 이전
- **(1) 국민연금 보험료율 연차별 단계적 인상 스케줄 (`2026년 9.5% → 매년 +0.5%p → 2033년 13.0% 상한`, `constants.ts`, `taxAndHealth.ts`, `ledgerKernel.ts`, `ControlDock.tsx`, `Lens2WaterfallLedger.tsx`)**:
  - `NATIONAL_PENSION_RATE_TOTAL = 0.095`, `NATIONAL_PENSION_RATE_ANNUAL_STEP = 0.005`, `NATIONAL_PENSION_RATE_CAP = 0.13`, `getNationalPensionRateTotal(elapsedYears)`, `getNationalPensionRateEmployee(elapsedYears)` 추가.
  - `solveExecutivePayroll`에 `elapsedYears = 0` 파라미터를 추가하여 만 60세 미만 은퇴 법인 임원의 국민연금 근로자·사용자 부담률이 경과연수(`idx`)에 따라 `4.75%` → `6.5%`로 자동 반영되도록 고도화(만 60세 이상은 기존과 동일하게 국민연금 면제).
- **(2) 51개년 원장 표 `세금·건보·유지비` 셀 개인세·법인세 인라인 병기 (`Lens2WaterfallLedger.tsx`)**:
  - 개인세금(`personalIncomeAndDivTax`)과 법인세(`corpCorporateTax`)가 동시에 발생한 연차에 팝오버를 열지 않아도 즉시 구분할 수 있도록 `세금(법인포함) X만 (개인 Y만·법인 Z만)` 형식으로 인라인 병기.
- **(3) 국내 주식형 지수 ETF(`KR_INDEX`) 매매차익 비과세 수정 & 핵심 종목(`273130`, `292150`, `069500`) 수익률·카테고리 보정 (`pensionAndEtf.ts`, `presets.ts`, `server.py`)**:
  - `evaluatePortfolio`에서 `h.category !== 'KR_INDEX'`를 국내 상장 기타 ETF 과세 대상에서 제외하여 `KODEX 200`(`069500`), `TIGER TOP10`(`292150`) 등 국내 주식형 지수 ETF의 일반계좌 매매차익 비과세를 정확히 반영.
  - `STARTER_SHELTERED_ETF_HOLDINGS`의 `273130`(`KODEX 종합채권(AA-이상)액티브`) 및 `server.py` `_KNOWN_TICKER_OVERRIDES`(`273130`, `292150`, `069500`)를 통해 수집기 플레이스홀더(`4.5% / 2.0%`)를 실제 시장 기대치로 보정하고 `isEstimated: False`로 정규화.
- **(4) 은퇴 시점(D-Day) 법인 설립 · 일괄 이전 옵션 (`CorporateInputs.injectionTiming: 'now' | 'retirement'`, `types.ts`, `ledgerKernel.ts`, `InputWizard.tsx`, `ActionGuideView.tsx`)**:
  - 재직 중 겸업제한 등으로 법인 즉시 설립이 어려운 사용자를 위해 Step 10에 `지금부터 분할 적립 (기본)` / `은퇴 시점(D-Day)에 법인 설립·일괄 이전` 선택기 추가.
  - `'retirement'` 선택 시 재직기(`isEmployed`) 동안 일반 금융자산과 초과 저축액을 개인 일반과세계좌에 100% 적립·운용한 뒤, 은퇴 D-Day 진입 시점에 일반계좌 평가액의 `cRatio%`를 매도하여 해외주식 양도세(`dDayCorpTransferOvTax`) 및 국내기타 ETF 배당세(`dDayCorpTransferKrxTax`) 원천 차감 후 순액을 법인 출자원금(`corpPaidInCapital`)으로 일괄 이전.
  - D-Day 당해 Stage 7 일반계좌 추가 인출이 발생할 경우, D-Day 법인 이전 매도에서 이미 사용한 해외주식 기본공제(`250만/500만`)가 중복 적용되지 않도록 `dDayOvRealizedGain` 누적 차감 가드를 적용하고 전 시나리오 `accountingResidual === 0원` 보존 항등식을 유지.
- **(5) Admin 상단 바 1줄 공간 예산 가드 & 인라인 소유자 캡슐 클러스터 (`emil-design-eng` Idea A, `src/App.tsx`, `src/styles.css`)**:
  - Admin(`role === 'owner'`) 접속 시 개별 나열되던 `🔐 소유자 모드`, `서버 저장`, `서버 복원` 버튼을 단일 캡슐 클러스터(`.owner-capsule-group`: `[ 🔐 소유자 ∣ ↑ 서버 저장 ∣ ↓ 서버 복원 ]`)로 통합.
  - 저장·복원 완료 시 별도 `.sync-notice-pill` 배지가 옆 버튼들을 밀어내는(Layout Shift) 대신, 캡슐 내부 버튼(`min-width: 74px`) 자체가 1.8초간 `✓ 저장됨` / `✓ 복원됨`(`ownerActionState`)으로 제자리 모핑되도록 개선.
  - `.btn`, `.app-mode-btn`, `.top-actions`에 `white-space: nowrap; flex-shrink: 0;`을 적용하고, 좌측 `.brand-sub`의 중복 `"NestWay Slider — "` 접두어 제거 및 `@media (max-width: 1420px)` 자동 축약을 통해 모든 해상도에서 상단 바 두 줄 꺾임을 원천 방지.


---

## 22. v1.2.15 스웜 품질 개선 (코드 · 디자인/UX · 금융엔진 3영역 dev↔eval↔cordi 합의 루프)
- **[코드 B1] 서버 보안·견고성 (`server.py`, `tests/test_server.py`, `vite.config.ts`, `scripts/run_tests.sh`, `README.md`)**:
  - **인증 무차별 대입 방어**: `/api/auth`·`/api/auth/owner`에 (경로, 접속 IP) 단위 인메모리 스로틀(`AUTH_MAX_FAILURES=5`, `AUTH_WINDOW_SEC=900`, 락 기반으로 병렬 우회 불가) — 초과 시 `429` + `Retry-After`, 성공 시 카운터 초기화, `X-Forwarded-For` 미신뢰. (전: 4자리 PIN 6.77초 탈취 → 후: 5회 실패 후 15분 잠금)
  - **원자적 상태 저장**: `/api/state` 저장을 O_EXCL 0600 임시파일 → fsync → `os.replace`로 교체, 손상 파일은 보존한 채 `500 state_corrupt`로 노출(조용한 '원장 없음' 제거).
  - **캐시 정책**: `index.html`/SPA/404 → `no-cache`, 해시 자산 `/assets/*` → `public, max-age=31536000, immutable`, `/api/*` → `no-store` (재배포 후 흰 화면 및 재무 JSON 캐시 방지).
  - **DX**: Vite dev 서버 `/api` 프록시(README 방법 A 정상화), `run_tests.sh` python unittest 중복 실행 제거(~5.6s 단축), unittest 11→16건.
- **[UX B1] 반응형 상단바·모바일 본문 & 실측 폭 SVG 차트 (`App.tsx`, `styles.css`, `src/components/useChartWidth.ts`, `Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`, `ActionGuideView.tsx`)**:
  - ≤1040px 상단바 2행 래핑 + 모드 전환기 3열 grid(`label-full`/`label-short`, `aria-current="page"`), ≤640px 아이콘 전용 액션 버튼(aria-label, 터치 타깃 ≥36px)·카드 푸터 세로 스택, ≤480px KPI 1열. (전: 390·768폭 scrollWidth 996 → 후: 390/768, 1040~1440 전 모드 가로 넘침 0)
  - `useChartWidth`(ResizeObserver) 기반 1 SVG unit = 1px 렌더로 축 라벨 크기를 폭과 무관하게 고정(전: 390폭 4~6px / 1440폭 17~20px → 후: 11px 고정, 박스 13px), 최소 560px + 가로 스크롤, 인쇄·측정 0 시 780 폴백(PDF 20p·viewBox 전후 동일), 효율곡선 X축 마지막 라벨 잘림 해소.
  - PDF 인쇄 트리에서 수익률 밴드 기본 OFF(전략 3선이 축 전체 사용).
- **[UX B2] 판정 히어로 · 실질/명목 정합 · 최적 기준 명시 (`src/components/planVerdict.ts`, `VerdictHeader.tsx`, `ActionGuideView.tsx` 외)**:
  - `classifyPlanVerdict`: 엔진 산출값만 매핑(위험 = `ALL_DEPLETE`·고갈 연령·미충족 생활비 > 0 / 주의 = 생존확률 < 90% 또는 월 여유분 < 100만 — Plan B 박스 노출 조건과 동일 / 그 외 안전). 브리핑 슬라이드 1을 `판정 히어로(배지·생존확률·지속가능 월생활비÷목표·100세 순자산 또는 고갈 나이) → 실행 한 줄 결론 → KPI` 순으로 재배치, 연산 ms 배지는 title로 이동, PDF PART I-2에도 반영(20p 유지).
  - 실질 모드에서 D-Day 총액을 같은 연차 원장 `discountFactor`로 환산하고 명목값 병기(예: `22억 8,863만 (현재가치 · 60세 시점 명목 29억 2,964만)`) — 슬라이드 1(22억)과 슬라이드 3(29억)의 화면 간 모순 해소. 계좌별 실행 금액은 명목임을 안내.
  - r* 비교 그리드에 `최적 기준: 100세 세후 순자산 최대` + 다른 전략의 월생활비가 더 높을 때 트레이드오프 1줄.
- **[UX B3] 위저드·브리핑 마감 품질 (`InputWizard.tsx`, `WizardLiveChip.tsx`, `ControlDock.tsx`, `PrecisionTuners.tsx`, `VerdictHeader.tsx`, `ActionGuideView.tsx`, `PasscodeGateModal.tsx`, `App.tsx`, `styles.css`)**:
  - 스텝바 11열 1행(≤1180px 가로 스크롤 + 활성 스텝 자동 추적, `aria-current="step"`), 프리셋 표시 라벨 정리(`60세 즉시 은퇴`, `빠른 시작 예시`), 모바일 프리셋 1줄 칩, 전역 `word-break: keep-all`, Step 11 CTA 단일화(`핵심 결과 브리핑 보기`).
  - 3단계부터 위저드 하단 **라이브 결과 칩**(`WizardLiveChip`: 판정 배지 · 100세 순자산 ▲▼ 증감 · 지속가능 월생활비, `aria-live=polite`, `useDeferredValue(plan)`).
  - 만원 단위 입력 19곳 실시간 읽어주기(`= 1억 5,000만`)로 자릿수 10배 오입력 방지.
  - 위험 상태 KPI/Plan B 문구 교정(`월 635만원 부족`, 의미 없는 `0x`·`+0원` 숨김, `null세` → `생활비 미충족`), 인증 429 안내(`약 N분 후 다시 시도`, 힌트 없음) + `/api/session`·인증 요청 `fetchWithTimeout` 적용.
  - 법인세·ISA 세율 문구를 엔진 상수(`CORPORATE_TAX_RATE_*`, `ISA_SEPARATE_TAX_RATE`) 참조로 교체(하드코딩 0건), Lens1 밴드 표본 수 통일(히어로·라이브칩·Lens1 생존확률 일치).
- **[엔진 B1] 2026 법정 상수 (`constants.ts`, `taxAndHealth.ts`, `presets.ts`)**: 지역건보 재산점수를 근사식에서 **국민건강보험법 시행령 별표4 60등급표**로 교체 + 세대 합산 재산 1억 1회 공제(공동명의 인별 공제 오류 제거; 공시 3억 공동명의 20,160원 → 92,366원/월), 법인세 **11%/22%**(2026 개정, 지방세 포함) · 기본값 소규모 성실신고확인 법인 22% · 레거시 커스텀 세율 무시, 이연퇴직소득 연금수령 감면 3단계(≤10년 70% / ≤20년 60% / 20년 초과 50%, 소득세법 §129①5의3).
- **[엔진 B2] 몬테카를로 순서위험 (`sensitivityBand.ts`, `ledgerKernel.ts`, `types.ts`)**: 전 기간 상수 시프트(40표본) → **연도별 i.i.d. 정규 수익률 경로**(σ 12%p, 변동성 끌림 보정 +0.72%p, antithetic 100표본, 시드 고정, WeakMap 캐시), `mcAssumptions` 노출. P50이 결정론 기준선에 수렴(DEFAULT 52.6억 → 33.1억, 기준 33.7억). 성능: 입력 1회 solve+band 18.7ms(1x) / 86ms(4x 스로틀).
- **[엔진 B3] 법인 실현주의 과세 정상화 (`ledgerKernel.ts`, `optimizer.ts`)**: 법인 원가(`corpBasis`) 추적 → 현금 유출 시 비례 실현차익 법인세(익년 신고), `resolveCorporateExitBreakdown`을 원장 청산가치와 출구 매트릭스가 공유(미실현 잠재 법인세 → 출자금 비과세 회수 → 의제배당 인별·N년 균등 종합과세 + Gross-up, 소득세법 §17·§56·§62). 종전 청산 15.4% 단일세율·법인 자본이득 영구 비과세 오류 제거.
- **[엔진 B4] 인별 과세·피부양자 판정 (`taxAndHealth.ts`, `ledgerKernel.ts`)**: 공적연금·임원 과표·배당(50:50)을 본인·배우자 **인별 귀속**해 종합과세(종전 부부 합산 1인 과세로 공적연금세 약 2배 과다), 건보 금융소득 1,000만 컷 인별 판정, 본인공제 이중 차감 제거, 사적연금 1,500만 초과 종합과세 비교 시 공적+사적 합계 공제 1회(공적 1,500만+사적 2,000만 @66세 1,230,900원 → 2,286,900원), 피부양자 판정을 인별 재산세 과표(공제 전, 보증금 제외, 공동명의 50%)·인별 소득·5.4억/9억 구간으로 교정.
  - **결론 변화(실질)**: 30개 표준 시나리오 중 법인 과반 추천 23 → **3**, DEFAULT r* 개인 8% → **75%**, 최적 100세 세후 순자산 34.60억 → 34.62억, 개인 100% 생애 건보 2.08억 → 1.88억. 전 구간 `accountingResidual === 0` (9,635 scenario-years).
- **[엔진 B5] 2차 정밀화 (`taxAndHealth.ts`, `ledgerKernel.ts`, `pensionAndEtf.ts`, `optimizer.ts`, `constants.ts`)**: ① 임원 1인 + 배우자 피부양자 탈락 시 배우자 지역보험료 가산(누락 비용 교정), ② 청산 의제배당 건보료를 세대 월 상한 4,591,740원(고시 제2025-222호) + 장기요양으로 산정해 `resolveCorporateExitBreakdown`에 일원화(원장 목적함수 = 출구 매트릭스 1~3안, 종전 ×0.5/×1 혼재 제거), ③ 법인 임원 고용보험 적용 제외, ④ 출생연도별 국민연금 수급개시연령(`getStatutoryPensionAge`, 국민연금법 부칙 §8: 1965~68년생 64세 등, 조기 −5/연기 +5), ⑤ 배우자 근속연수 분리(`spouseServiceYears`), ⑥ 직장 보수외소득 공적연금 50% 평가(시행규칙 §44②2호) 확인·유지. 결과: DEFAULT r* 76%, 최적 34.81억, 60세 즉시 은퇴 25.99억 → 27.05억.
- **[UX B4] 판정 임계 재보정 (`planVerdict.ts`, `VerdictHeader.tsx`, `ActionGuideView.tsx`, `WizardLiveChip.tsx`)**: 연도별 MC 분포에 맞춰 안전 ≥ 80% & 월 여유분 ≥ 100만 / 주의 60~79% / 위험 = 결정론 고갈·ALL_DEPLETE·미충족 또는 < 60%(`시장 변동 시 고갈 위험이 큽니다`로 구분), Plan B 트리거를 `shouldShowPlanB`로 단일화(판정↔Plan B 모순 0건), 히어로 캡션 `표본 100개 · σ 12%p · 오차 ±5%p` + `mcAssumptions` 툴팁, 55~64%·75~84% `경계값` 배지. 30개 시나리오 분포 안전 16 / 주의 9 / 위험 5.
- **[UX B5] 법인 미설립 최적안 정합 (`Lens3StrategyMatrix.tsx`, `ActionGuideView.tsx`)**: 최적안 법인 0%이면 출구 매트릭스·임원 비교에 `법인 100% 가정 참고치 — 실행 권고 아님` 배너, `BEST EXIT`/`권장` 배지 숨김, 분석 03 KPI `법인 미설립`.
- **[UX B6] 국민연금 수급연령 동적 표기**: 위저드 선택지·라벨·브리핑·분석 03·Lens1 마커·Lens3 설명의 60/65/70세 하드코딩을 엔진 `getPensionClaimStartAge` 기반으로 교체(60세 프리셋 59/64/69세).
- **[엔진 B6] 실행 체크리스트 문구 정합 (`optimizer.ts`)**: 법인 미설립 최적안에서 act-2/3/4의 가수금·임원보수·출구·승계 권고 제거(`법인 미설립 — 출구전략 해당 없음`), 1인 가구 `본인 ISA`, 절세액·손익분기 표기를 `formatKRW`로 통일(`+0억 원`·`+13,949만 원` 오표기 제거), 단순 청산 추천 시 `추가 절세 효과 없음`.
- **[엔진 B7] 강건 권고 비율 (`optimizer.ts` `recommendAllocation`, `types.ts`)**: 수학적 r*는 `optimalHybrid`에 보존하고, 법인 포함 권고는 **강건성**(유지비 ×1.5 및 수익률 −0.5%p 섭동에서도 hybrid > 개인 100%) **+ 월생활비 비열위**(≥ 개인 100% − 5만원) 또는 고갈 구제/고갈 연령 +3년일 때만 채택. auto 모드의 activeLedger·winner·체크리스트가 권고 비율을 따르며 `recommendation.reason`에 이득률·절대액·월 차이·강건성 실패 원인 명시. 임원 고용보험 0.9% 같은 미세 비용 변화로 r*가 100↔4로 튀던 6개 시나리오(N06·N07·N08·N09·N11·N27)는 개인 100% 권고로 안정화(법인 포함 권고 35건 중 18건).
- **[UX B7] 국민연금 설명문 분기 (`Lens3StrategyMatrix.tsx`)**: ROI 박스가 엔진 `pensionComparison` 결과로 분기 — 연기 우위면 순자산 차이·연기 월액·교차 연령(`crossoverAgeVsNormal`)·100세 누적 수령액으로 근거 제시(종전: 권고가 연기인데도 '정상수령이 더 큰 이유'를 무조건 표시).
- **[UX B8] 권고 사유·마커 표시 (`ActionGuideView.tsx`, `Lens1AllocationTrack.tsx` 외)**: 권고 ≠ 수학적 r*이면 슬라이드 1(및 PDF)에 `권고 사유` 표시, 배분 효율 곡선에 `★ 수학적 최적 r*`·`✔ 권고` 마커 2개, 전략 카드 배지 `권고`/`수학적 최적 r*` 분리, X2 문구를 권고 기준으로 갱신 — 히어로·KPI·슬라이드 5·6·분석 01·곡선 7곳이 권고 비율 하나로 일치.
- **[코드 B3] 렌더 크래시 복구 카드 (`src/lib/ErrorBoundary.tsx`, `src/main.tsx`)**: 최상위 ErrorBoundary가 렌더 예외 시 `role="alert"` 복구 카드([다시 시도] / [입력값 초기화 후 다시 시작] — `retire_opt_inputs_v1` → `retire_opt_inputs_v1_crash_backup` 백업 후 삭제)를 표시하여 영구 흰 화면을 방지. 키 드리프트 방지 정적 계약 테스트 포함(unittest 17건).

## 23. v1.2.16 독립 검토 반영 구축 계획 v2 (엔진 정확성 · 화면 단일 정본 · 공개 가정)
> 근거: 세무·엔진 독립 재현 검토(16개 과제 판정) 및 구축 계획 v2(Keep 8건 · D1~D8 확정). 배치별 커밋 `9043107`·`8368554`·`3526190`·`379b088`·`6edef9a`.
- **[B1 엔진 커널] (`ledgerKernel.ts`)**:
  - **E-3 부부 공동임원 국민연금 인별 판정**: 임원별 만 나이로 60세 미만 사업장가입 판정(`solveHouseholdExecutivePayroll`) — 표준 프리셋 본인 60·61세(배우자 58·59세) 4대보험 +364만 과소 해소, 역방향(본인<60·배우자≥60) 과다 부과 방지.
  - **E-5b 재직 중 공적연금 수령**: 수급개시 연령 도달 시 재직 여부와 무관하게 본인·배우자 노령연금 유입(은퇴 67세 입력 시 65·66세 연 3,128만/3,207만 누락 해소, 연상 배우자 연금 반영).
  - **E-1 법인 고갈 연도 법인세**: 법인이 납부하지 못한 이월 실현차익 법인세를 주주 2차 납세의무(국세기본법 §38)로 익년 가계 현금 의무에 편입하고, 미납 기간에는 순자산에서 부채로 차감(수동 비율 fire r=0, 91세 1,679만 증발 해소 · 권고 비율 영향 0).
  - **E-2 100세 연금계좌 청산세**: `resolvePersonalExitNetWorth` 7번째 옵션 — 법인 출구와 같은 분할연수·인별 연 1,500만 3.3% 저율 한도·초과분 16.5% 분리과세(기존 일괄 3.3% 대비 18.04억 잔고 청산세 0.60억 → 2.58억).
  - **결과**: 표준 r* 76→74%, B7 강건성 권고 76→**개인 100%**(하이브리드 실질 우위 1억 5,783만 → 4,957만), late 76→74, immediate 72→71. 전 프리셋 r* = 0~100% 전수 탐색 최적값.
- **[B2 판정 엔진] (`optimizer.ts`)**: E-4 B7이 법인안을 기각하면 손익분기 배지·판정문·체크리스트(act-3)를 개인 기준으로 동기화(배지 `개인 절세계좌 단독 권장`, act-3 = 개인 100% 은퇴 첫해 지역건보료), 판정문 하드코딩 "48년" → 실제 은퇴 연수, G2 손익분기 유지·보수 비용과 임원 구조 비교 4대보험을 원장 첫 은퇴연도(임원별 나이·요율)와 일치(표준 851만 → 772만).
- **[B3 화면 단일 정본] (`types.ts`, `optimizer.ts`, `planVerdict.ts`, `VerdictHeader.tsx`, `ActionGuideView.tsx`, `Lens3StrategyMatrix.tsx`, `InputWizard.tsx`, `Lens1AllocationTrack.tsx`)**: U-1 `plan.activeCard`(활성 비율 카드, 수동 중간 비율은 지속가능 월생활비 이분탐색 실계산)를 칩·판정 히어로·KPI·브리핑 Tile 1/Slide 1 여유분·Plan B·Lens3 A/B가 공유, KPI1 열위는 "−X 열위"로 표기("+0원 우위" 제거), 위저드 Step 10/11은 권고 비율 표시 + r* 참고·B7 사유, Lens1 궤적 차트는 activeLedger(권고안/선택안) + 수동 선택 핀.
- **[B4 원장·Step 7·공개 가정] (`Lens2WaterfallLedger.tsx`, `InputWizard.tsx`, `PasscodeGateModal.tsx`, `styles.css`)**: U-3 원장 각주 법인세율 동적 표기, 두 CSV의 금액 열에 화면과 같은 실질/명목 환산 적용 · U-4 Step 7 연동 모드 IRP 70% 배너·체크를 엔진 적용 조건과 일치, 탭 상태 저장값 복원 · D1 연금계좌 세액공제 환급 미반영(보수적 가정) 안내 · D3 원장 팝오버 상단 잘림 시 아래로 열기 · D4 인증 모달 문구 한국어화(중립 placeholder 유지).
- **보류·제외(검토 보고서 판정)**: U-2·U-5·C-1(1줄만 병합) 보류, E-6·U-6·C-2·C-3·C-4 제외, D2(KRX 과세형 ETF·ISA 청산세)·D5(시나리오 저장)·D6(국민연금 소득활동 감액) 보류.
- **검증**: `bash scripts/run_tests.sh` exit 0 — ledgerInvariants 9,635 scenario-years 회계 잔차 0원, optimizer(B7·손익분기·활성 카드 auto 5종 + 수동 7비율), uiParity, tsc, python 17.

## 24. v1.2.17 게스트 기본 조건 정리
- **게스트 클린 시작 (`App.tsx`)**: 패스코드로 게스트 로그인하면 같은 브라우저에 남아 있던 이전 입력(예: 표준 예시) 대신 일반 기본 조건(`DEFAULT_SIMULATION_INPUTS` = 50세 부부 → 60세 은퇴, 일반 금융자산 10억 + 절세계좌 2.9억, 자가 공시가 12억, 월저축 500만, 목표 월생활비 500만)으로 시작. 세션 유지 중 새로고침은 편집값 보존.
- **'표준 예시 (50세 → 53세 은퇴)' 버튼 제거 (`InputWizard.tsx`)**: 빠른 시작 예시는 연령대별 5개 프리셋만 노출, 19개 표준 조건 빌더 삭제.

## 25. v1.2.18 핵심 결과 브리핑 간결화 (설명문 → ⓘ 팝업, 숫자 카드 → 차트)
> 근거: 브리핑 6장 실측 — 차트 0개, 본문 글씨의 79~96%가 14px 미만, 슬라이드 1 숫자 74개. 결정: 팝업 = 브라우저 기본 `popover`, 슬라이드 6장 유지.
- **ⓘ 팝업 (`InfoPop.tsx`)**: 브라우저 기본 `popover`(top layer · 바깥 클릭/ESC/✕ 닫힘 · 키보드 포커스) + `popovertarget` 버튼. 기존 문장을 그대로 옮겨 정보 손실 없음. 인쇄 시 숨김 — PDF 마스터플랜 리포트는 별도 분기에서 펼친 문장을 그대로 출력(`VerdictHero` 기본 `criteriaMode='inline'`).
- **시각 요소 (`BriefingVisuals.tsx`, 외부 라이브러리 없음, 원장·카드 값만 사용)**: 순자산 미니 곡선, 전략 가로 막대, 100% 누적 막대 + 범례, 1→2→3 흐름도, 나이별 재원 누적 막대.
- **슬라이드별**: ① 판정 배지 + 핵심 숫자 3개 + 한 줄 결론 + 100세까지 순자산 곡선 (판정 기준·권고 사유·배분 상세·연령대별 순자산·하방 시나리오·Plan B는 ⓘ) ② 연간 적립 배분 막대 + "매년 X → 은퇴 시 Y" ③ 은퇴 당일 5대 계좌 누적 막대 + 범례 ④ 인출 1→2→3 흐름도 + 나이별 생활비 재원 구성 ⑤ 3전략 100세 순자산 가로 막대 ⑥ 국민연금 개시 시기 한 줄 + 생애 단계 체크리스트 타임라인. 각 슬라이드 부제는 제목 옆 ⓘ, 상단 중복 "심층 차트" 버튼 제거(하단 바 유지).
- **실측 (같은 프로브, 1280×720, 슬라이드 카드 전체)**: 글자 수 1,395/800/1,311/959/1,015/1,179 → 479/368/469/399/411/496 (−56~66%), 숫자 78/26/56/21/42/22 → 22/13/18/10/14/6. 390px 폭 가로 넘침 0, 콘솔 에러 0.

## 26. v1.2.19 법인세 성실신고확인대상(22%) 요건·회피 가이드 + 연도별 판정
> 근거: 법인 22%(성실신고 소규모법인) vs 11%(일반) 차이가 법인 손익분기를 좌우. 일반적인 가족법인 운영 원리·절차·유의사항만 반영(특정 법인 형태 표기 미포함 정적 가드).
- **엔진 (관측 전용, 기존 결과 불변)**: 원장 행에 `corpDividendIncome`(법인 수령 배당)·`corpRealizedSaleGain`(과세 대상 실현 매매차익) 추가. `assessSincereFiling`(배당+이자 ÷ 매출 ≥ 50% → 해당 가능, 50% 미만에 필요한 추가 매매차익) · `summarizeSincereFiling` → `plan.sincereFilingSummary`(activeLedger 기준, 투자업 등록·매매차익 매출 계상 전제, yearly 인식 모드는 근사치 표기).
- **결과 5**: ⓘ "성실신고 22% 피하는 법"(요건 3가지 · 핵심 원리 · 절차: 목적변경 등기 → 기타 금융업 659902 업종 추가 → 법인 증권계좌 → 연말 가결산 · 함정 3가지 · 실질과세 면책) + "배당 우세 N/M년" 배지(법인 수익 연도 있을 때).
- **결과 6 / 체크리스트**: `act-5-sincere` "연말 가결산: 배당·이자가 매출의 50% 미만인지 확인" — 상태 문구(매년 미충족 / 회피 어려움 / 연말 추가 매매차익 최대 X원).
- **PDF PART III · Lens1 손익분기 카드 · 법인세 과세 체계 도움말**: 같은 가이드와 안내 문구. 세율은 2026년 기준(일반 11%/22%, 성실신고 22%, 지방세 포함)을 `CORP_TAX_PCT`에서 읽어 표기.

## 27. v1.2.20 — ⓘ 팝업 가독성 (다열 카드 넓은 패널)

- 문제: 기본 팝업 폭(640px)에 4~5열 카드가 들어가 열당 ~110px — 금액·라벨이 한두 글자씩 세로로 줄바꿈되어 읽기 어려움.
- `InfoPop`에 `wide` 옵션 추가 → `.info-pop-panel--wide` (폭 `min(1120px, 94vw)`, 높이 `min(84vh, 880px)`).
- 적용: 결과 1 「배분 상세」(4열 KPI)·「하방 시나리오」(3열), 결과 3 「계좌별 산식·운용 규칙」(5대 계좌 5열), 결과 6 「출구전략·검증」(3열). 설명형 단일 문단 팝업은 기존 폭 유지.
- 팝업 안의 KPI 바는 sticky 해제(팝업 헤더와 겹침 방지).
- 가드: `uiParity` §27 — `wide` prop·CSS·4개 팝업 적용 확인.

## 28. v1.2.21 — 팝업(Popup · Modal · Popover) UX 전수 실측 및 선별 개선 (5건)

- **결과 1 `ⓘ 연령대별 순자산` (`ActionGuideView.tsx`)**: 5열 그리드(`.briefing-milestone-strip`)가 기본 폭(640px, 열당 113px)에서 세로 줄바꿈되던 문제를 해소하기 위해 `wide`(1120px, 열당 ~202px) 적용.
- **결과 6 `ⓘ 출구전략·검증` (`ActionGuideView.tsx`, `styles.css`)**: 2개 카드에 3열 그리드 + `wide`가 적용되어 우측 1/3이 빈 공간으로 남던 문제를 해소하기 위해 `wide`를 제거(640px 기본 폭)하고 `.wizard-2col-grid`(2열 그리드)로 전환.
- **결과 1·2·3·4 팝업 내부 이중 테두리·중복 헤더·중복 막대 정리 (`styles.css`)**: PDF 인쇄 마크업은 그대로 보존하고, `.info-pop-body` 직계 카드(`.playbook-step-card`, `.playbook-dday-box`, `.plan-b-advisory-box`)의 중첩 테두리·배경·외곽 패딩 및 중복 서브헤더/누적 막대(`.blueprint-stack-bar`)를 화면 팝업에서만 숨김.
- **결과 5 `ⓘ 성실신고 22% 피하는 법` (`ActionGuideView.tsx`, `SincereFilingGuide.tsx`, `styles.css`)**: `wide` 패널 적용 + `.info-pop-panel .sincere-filing-grid` 2×2 그리드 배치로 `1440×900` 데스크톱에서 세로 스크롤 없이 `① 요건`~`④ 함정`과 `연말 점검`이 한 화면에 노출되도록 개선(PDF 출력은 기존 1단 유지).
- **소유자 전환 모달 `ESC` 및 배경 클릭 닫기 (`PasscodeGateModal.tsx`)**: `onCancelOwnerUpgrade` 전달 시 `Escape` 키 및 `.modal-backdrop` 직접 클릭(`e.target === e.currentTarget`)으로 닫기 지원(중립 placeholder 유지).

## 29. v1.2.22 — 빠른 시작 예시(프리셋) 6종 개편 (법인 50% 균형 · 법인 100% 집중 사례 추가, `55→60세` 중복 프리셋 제거)

- **중복 프리셋 제거 (`src/engine/presets.ts`)**: `60세 즉시 은퇴`(법인 29%)와 배분 포지션이 중복되던 `late-55-60`(`55세 -> 60세 은퇴`, 법인 26%)을 제거.
- **신규 추가 ① `hybrid-50-55-corp50` (`50세 -> 55세 은퇴 (법인 50% 균형)`)**: 부부 2인(50/48세 → 55세 은퇴) · 일반금융 12억(성장 30%·5.5%, 배당 70%·5.5%, 해외직투 30%) + 절세 3.5억 · 자가 18억 공동명의 · 임원 2인(인당 월 150만) · 은퇴 전 월 저축 500만 · 목표 월생활비 500만. 금융소득종합과세(인별 2,000만) 경계 분할과 부부 임원급여·출자원금 비과세 회수가 결합되어 **수학적 최적 `r* = 개인 50% : 법인 50%`** 및 **최종 실행 권고 `개인 50% : 법인 50%`**(`winner = 'hybrid'`, 개인 100% 대비 `+2억 9,804만` 우위, 생존확률 88% 안전) 달성.
- **신규 추가 ② `corp-100-focus` (`55세 -> 55세 은퇴 (법인 100% 집중)`)**: 부부 2인(55/53세 → 55세 즉시 은퇴) · 일반금융 15억(배당 100%·6.5%, 성장 3.0%, 국내상장 100%) + 절세 3.5억 · 자가 18억 공동명의 · 임원 2인(인당 월 300만) · 목표 월생활비 450만. 개인 명의로 이미 확보된 절세계좌(3.5억) 외 일반 고배당 자산(15억) 전액을 법인으로 출자하여 부부 임원급여 손금산입 + 직장건보 방어 + 출자원금 무세금 회수로 **수학적 최적 `r* = 개인 0% : 법인 100%`** 및 **최종 실행 권고 `개인 0% : 법인 100%`**(`winner = 'corporate'`, 개인 100% 대비 `+4억 4,333만` 우위, 생존확률 94% 안전) 달성.
- **검증**: 6개 프리셋 전 구간 회계 잔차 `0원`(`ledgerInvariants`), `hybrid-50-55-corp50`(법인 50%)·`corp-100-focus`(법인 100%) 수렴 단언(`optimizer.test.ts`), 6개 프리셋 순서·라벨 정적 가드(`uiParity.test.ts`).

## 30. v1.2.23 — 금융엔진 법정 정밀화 · HNWI/세무사 세목 확장 · UX 대비/단위 정합성 · 4-Part PDF 마스터플랜 개편

- **금융엔진 법정 정밀화 (Batch 1)**: 55세 이후 연금저축·IRP 선인출 및 ISA 비과세 보존(`1-A`), 시장 스트레스 시나리오 절세계좌 대칭 적용, KRX ETF 과세 프로파일 정밀 분류 및 청산세·건보 반영, 국민연금법 §63조의2 제3호(조기노령연금 지급정지 감액 완화)·§66 및 국민건강보험법 지역건보 상한(2026년 월 4,374,270원), 소득세법 시행령 §40조의2 비세액공제 연금원금 0% 비과세 반환 구현.
- **HNWI/세무사 세목 확장 (Batch 2)**: 지방세법 §111·종합부동산세법 §9 재산세·종부세 3단계(기본공제·공정시장가액비율·누진세율) 분리 계상, 거주주택 부부 공동명의 지분율 옵션, 법인세법 §13 15년 이월결손금 공제 한도(80%) 시뮬레이션, 2027+ 법인 배당 11% Gross-Up 일몰 분기, 법인 자본금 vs 무이자 가수금 회수 경로 분리, 상증세법 §22 금융재산상속공제(최대 2억)·§26 누진세율(10~50%) 100세 상속세 진단.
- **UX 사용성 · 고대비 · 단위 정합성 (Batch 3)**: 다크모드 및 라이트모드 WCAG 2.1 AA 명도비 개선(`:root[data-theme='dark'] { color-scheme: dark; }`), 원장 첫 열(연차) sticky 고정열 지원, 실질(현재구매력) vs 명목(미래액면가) 전 구간 단위 표시 통일.
- **4-Part PDF 마스터플랜 개편 및 법적 고지 (Batch 4)**: A4 Landscape 인쇄 시 다열 그리드 붕괴 방지(`@media screen and (max-width: ...)`), `.print-part-header` orphan 방지(`break-after: avoid`), 표지 마스트헤드 `NESTWAY SLIDER · PRIVATE WEALTH & TAX SIMULATION REPORT` 및 세무사법 제2조·자본시장법 제6조 안전 고지 표기, STEP 07 5대 계좌 동일 기대수익률 사실성 정비, PART III 법인 미설립 시 1박스 배너화, PART IV 세목별·주요 연령대(은퇴/국민연금/75세/85세/100세) 법정 산식 검증 부록(`.print-statutory-appendix-table`) 신설, Masterplan CSV 1-A 인출 순서 및 주택보유세 열 추가, D-Day 운용자본 실질 할인 단위 일치(`scaleDdayFor`).


---

## 31. v1.2.24 — 패스코드·소유자 서버 인증 제거 및 로컬 JSON 시나리오 내보내기·불러오기 도입

- **무상태(Stateless) 서버 전환 (`server.py`, `src/components/PasscodeGateModal.tsx` 삭제)**: 게스트 패스코드·소유자 PIN 인증(`/api/auth`, `/api/auth/owner`, `/api/session`) 및 단일 파일 서버 원장 저장(`/api/state`)을 완전히 제거하여 서버가 개인 재무 데이터를 0바이트 보유하도록 단순화하고, 12시간 세션 만료 재인증 시 입력값이 초기화되던 불편을 해소했습니다.
- **로컬 JSON 시나리오 내보내기·불러오기 (`src/lib/scenarioIo.ts`, `src/App.tsx`)**: 상단 헤더에 `📥 내보내기` · `📤 불러오기` 버튼을 추가하여 `nestway_plan_YYYYMMDD_<은퇴연령>세은퇴.json` 포맷 저장과 기존 `user_state.json`(`{ inputs }`) 및 순수 `SimulationInputs` 루트 객체 하위호환 복원(1MB 상한, 프로토타입 오염 및 비유한수·열거형 정화 검증 포함)을 지원합니다.

---

## 32. v1.2.25 — 모바일(≤640px) 레이아웃 · 터치 입력 · 도움말 바텀시트 (C1)

- **적용 범위**: 모든 규칙을 `@media screen and (max-width: 640px)` 안에 두어 노트북(창 분할·터치 노트북 포함)과 PDF 인쇄 레이아웃은 바뀌지 않음. 금융엔진(`src/engine/*`) 변경 없음.
- **1열 전환**: D-Day 5대 계좌(`.action-basket-grid`), 상세 분석 4타일(`.analysis-tile-grid`), Step 11 요약(`.wizard-summary-grid`), 연령대별 순자산(`.briefing-milestone-strip`), ETF 프리셋 칩(`.etf-preset-chips`)이 좁은 화면에서도 2열로 남아 금액이 꺾이던 문제 해소.
- **브리핑 6탭 한 줄 스크롤**: `.briefing-stepper-bar`를 3열×2행에서 한 줄 가로 스크롤로 바꾸고, 위저드 스텝바와 같은 방식으로 현재 탭을 가운데로 맞춤(`aria-current="step"` 추가).
- **iOS 입력 확대 방지**: `(max-width: 640px) and (hover: none)`에서만 입력칸·셀렉트 글자를 16px로 키움. `NumericInput`에 `inputMode="decimal"`을 추가하고 `type="number"`·`step`은 유지(노트북 방향키 조작 그대로).
- **ⓘ 도움말 탭 동작 수정**: `FieldHelpBadge` 23개 중 20개가 `<label>` 안에 있어 탭하면 입력칸으로 포커스가 넘어가 키보드가 뜨고 도움말이 닫히던 문제를 트리거 클릭의 기본 동작 차단으로 해결.
- **하단 시트**: ⓘ 도움말과 원장 산출 근거 팝오버를 좁은 화면에서 화면 하단 시트로 표시(160ms ease-out 진입). `.precision-drawer`·`.analysis-drilldown-panel`의 평소 항등 transform을 모바일에서 해제해 시트 위치가 서랍 기준으로 잡히지 않게 함. 브리핑 ⓘ 팝업도 같은 하단 위치로 정렬.
- **터치 영역 44px**: 상단 버튼, ETF 삭제, 팝업 닫기. 요약 카드 `[수정 ✎]`은 보이는 크기는 그대로 두고 누르는 영역만 확장.
- **(C1-b) Pixel 에뮬레이션 실측으로 찾은 기존 모바일 결함 2건 (≤640px, CSS만)**: ① 4-KPI 판정 바(`.verdict-bar`)가 1~2열로 쌓인 채 상단에 고정되어 화면의 61%(449/731px)를 가리던 문제 → 모바일에서 고정 해제. ② 브리핑 결과 1 순자산 미니 곡선의 은퇴·80세·100세 금액 라벨이 서로 겹치던 문제 → 금액을 두 줄로 줄바꿈해 라벨 폭 축소. ③ (모든 화면) 51개년 원장 표의 고정 첫 열(연령)이 정의되지 않은 `--bg-card` 변수로 투명해져 가로 스크롤 시 다음 열 숫자와 겹치던 문제 → 카드 배경(`--bg-panel`)으로 수정하고 D-Day 강조 행은 강조색 유지.
- **(C2) 배분 효율성 곡선 터치 오적용 방지 (`Lens1AllocationTrack.tsx`)**: 모바일에서 값을 보려고 점을 탭하기만 해도 비율이 적용되고 `r*` 자동 최적이 꺼지던 문제를 수정. 터치는 첫 탭에 툴팁만 열고(“다시 탭하면 적용”) 같은 점을 다시 탭해야 적용(`resolveCurveTap`). 마우스는 기존처럼 클릭 즉시 적용. 나머지 차트 3종은 탭 툴팁이 이미 동작하고 가로 스크롤이 필요해 변경하지 않음.
- **(C3) Plan B 단일 레버 정량 해소치 (`planVerdict.ts` `computePlanBLevers`, `ActionGuideView.tsx`)**: 위험·주의 판정 시 브리핑 결과 1과 PDF Plan B 박스에 “아래 중 하나만 바꿔도 해소됩니다: ① 은퇴 후 월 생활비 −X ② 은퇴 +N년 ③ 은퇴 전 월 저축 +Z”를 표시. 해소 기준은 판정 임계와 같은 ‘100세까지 고갈 없이 월 여유 100만 원 이상’이며, 후보마다 결정론 원장 1회로 판정(Plan B 표시 시에만 계산, 원장 약 30회 · 실측 ≈ 15ms). 몬테카를로 생존확률은 탐색에 쓰지 않고 “생존확률 판정은 별도라 ‘주의’가 남을 수 있음”을 명시. 결정론 기준을 이미 충족한 경우(생존확률만 미달)는 수치 대신 하락장 대응 안내. 다른 조건과 개인:법인 비율은 고정, 은퇴 전 저축 레버는 은퇴 전일 때만 표시. 산출값을 원장에 다시 넣어 해소·최소성을 확인하는 왕복 테스트 추가.

---

## 33. v1.2.26 — 에디토리얼 웰스 바인더(Warm Editorial Wealth Binder) UX 테마 적용

- **Warm Paper & Ink 디자인 토큰 체계 (`src/styles.css`)**: 스톤 도트 그리드 배경(`#e8e4da` + `radial-gradient`), 중립 웜 아이보리 바인더 시트(`#faf8f4`), 화이트 데이터 카드(`#ffffff`), 고대비 에디토리얼 잉크 프레임(`#141413`) 및 시그널 골드 배지(`#fde047`)를 도입하되, 5대 금융계좌 고유 색상(`--basket-*`)은 100% 보존하고 안전·주의·위험 판정 및 강조 채움 배지(`--on-status`, `--accent-fill`)는 라이트·다크·인쇄 전 구간 WCAG AA 명도비 이상으로 보정했습니다.
- **최상단 에디토리얼 마스트헤드 및 3모드 사다리꼴 바인더 탭 (`src/App.tsx`, `src/styles.css`)**: 최상위 3단계 워크플로우(`STEP 01 조건 입력` · `STEP 02 핵심 결과 브리핑` · `STEP 03 상세 분석 & 원장`)에만 사다리꼴 바인더 폴더 탭(`.binder-tabs-bar`)과 `.binder-sheet` / `.binder-arch-inner` 프레임을 적용하고, 하위 10단계 위저드 스텝바 및 6단계 브리핑 스텝바는 모노스페이스 인덱스가 적용된 넘버드 레일로 분리하여 이중 탭 혼잡을 방지했습니다.
- **보더 두께 위계 및 입력 피로도 완화**: 외곽 포커스 카드·판정 히어로·벤토 타일·원장 래퍼에는 `1.5px` 잉크 프레임을 적용하는 반면, 내부 숫자 입력창(`.dock-input-unit`), 셀렉트, `.wizard-primary-input-box`는 부드러운 `1px` 웜 보더와 포커스 링을 유지하여 다단계 입력 피로도를 최소화했습니다.
- **다크 모드(`Warm Espresso`) · 모바일 바텀시트 · 4-Part PDF 리포트 격리**: `[data-theme='dark']` 전용 차콜·본(Bone) 팔레트 매핑, 휴지 상태 `transform: none` 유지로 모바일(`≤640px`) `position: fixed` 바텀시트 기준점 보호, `@media print` 도트 배경 및 바인더 크롬 제거로 A4 가로형 PDF 마스터플랜 리포트 정합성을 보존했습니다.
