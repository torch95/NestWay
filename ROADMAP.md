# 🗺️ NestWay Slider — 은퇴 금융자산 최적화 워크벤치 Product & Engineering Roadmap

> **Application**: NestWay Slider — 은퇴 금융자산 최적화 워크벤치 (`nestway_slider`)
> **Runtime & Endpoint**: `http://localhost:8089` (`nestway-slider.service`, Port `:8089`)
> **Repository & Branch**: `https://github.com/torch95/NestWay.git` (기본 브랜치 `main` 및 `nestway-slider`)
> **Audit Baseline**: 2026-10-07 코드베이스 전수 정합성 감사 및 실행 검증 (`bash scripts/run_tests.sh` 7대 TS 스위트 + 11개 Python unittest **100% PASS**, `accountingResidual === 0원` **2,471개 시나리오-연차** 무결성 확인)

---

## 📊 1. 현행 기능 및 정합성 실측 감사 요약 (Current Integrity Audit Baseline)

### 1.1 검증 완료된 코어 역량 (`v1.2.4` 정상 가동)
| 영역 | 구현 모듈 | 실측 검증 결과 |
| :--- | :--- | :--- |
| **단일 5대 계좌 원장 커널** | `src/engine/ledgerKernel.ts` | `IRP` · `ISA` · `연금저축` · `일반과세` · `가족법인` 5대 바스켓을 단일 상태 전이 함수(`runCanonicalLedger`)로 구동하며, 5대 연령별 대표 프리셋 × 5개 배분비율 + 19개 표준 조건 + 사적연금 개시연령 지연/경계 + 부부 퇴직금 인별 분리 + 국민연금 추납 원금 차감(`GAP-02`) + 비정기 일회성 현금흐름 이벤트 시나리오 총 **2,471개 시나리오-연차 전체에서 `accountingResidual === 0원` (1원 단위 회계 보존 항등식)** 성립 검증 완료 |
| **8단계 절세 인출 워터폴 & 황금분할 솔버** | `src/engine/optimizer.ts`, `src/engine/sensitivityBand.ts` | ① 국민·주택연금 ➔ ② 법인 임원급여 ➔ ④ ISA ➔ ⑤ 사적연금 저율한도(`1,500만/인`, 사용자 지정 개시연령 및 IRP 운용수익 저율 캡·부부 퇴직금 인별 지분 반영) ➔ ⑥ 법인 출자원금 비과세 회수 ➔ ⑦ 일반과세계좌 ➔ ⑧ 법인 추가배당. 황금분할 탐색 + 1% 그리드 언덕오르기로 약 `40ms` 내 최적해(`r*`) 및 고갈 방어(`allocationStatus: 'ALL_DEPLETE'`) 판정, 시드 고정 PRNG(`mulberry32`) 기반 `±2.0%p` 민감도 밴드 및 `P10/P50/P90` 100세 생존확률 산출 |
| **한국 세법·2026 건보료 정밀 계산기** | `src/engine/taxAndHealth.ts` | 본인·배우자 인별 일시금/IRP 퇴직소득세(근속연수 공제·환산급여·연금수령 30%/40% 감면, 비-IRP 일시수령 시 D-Day 원천징수 즉시 차감), 부부 해외주식 양도소득세 연 500만 원 기본공제 합산, 개인·법인 기말 대칭 청산세(`GAP-03`), 법인 배당의 임원 근로소득 상위구간 적층(Stacking) 및 익년 건보료 이월(`pendingDividendIncomeForHealth`), 2024~2026 지역건보 개편안(재산 기본공제 1억·자동차 건보 폐지·피부양자 적격 판정) 반영 |
| **3-모드 워크벤치 & 1,274종 ETF 빌더** | `src/components/*.tsx`, `server.py` | `① 조건 입력 위저드(10+1단계)` · `② 금융자산 구성 가이드(적립 브릿지 + 1-Click PDF 마스터플랜 리포트 포함) & 4-타일 벤토 분석` · `⚡ 전문가 통합 뷰` 간 1원 오차 없는 상태 동기화(`uiParity.test.ts`), `6. 일반·법인 수익률` 및 `7. 절세·연금 수익률` 2단계 슬라이드 분리, 비정기 일회성 현금흐름 이벤트 슬롯(최대 5개 + 4종 프리셋), 51개년 원장 셀 인라인 브레이크다운 및 세금·건보 4대 개인세목 영수증 팝업 완료 |


---

### 1.2 현존하는 정합성 과제 및 상용 고도화 대상 (Remaining Audit Gaps)

Phase 16까지의 세무·건보 정밀도 감사(`GAP-02`, `GAP-03`), 비정기 일회성 현금흐름 이벤트, 1-Click PDF 마스터플랜 리포트, 결정론적 수익률 민감도 밴드(`P10/P50/P90`) 구현을 통해 핵심 정합성 및 리포팅 과제가 완결되었으며, 현재 남아 있는 후속 고도화 과제는 다음과 같습니다.

1. **[GAP-06 · P2] 인출 단계(Stage 4 ISA 누적 비과세 한도 · Stage 7 국내상장 해외ETF 과세) 및 국민연금 초과소득 감액(`NATIONAL_PENSION_A_VALUE_MONTHLY`) 정밀화**
   - **현상**: ISA 비과세 한도(`200만/400만 원`)의 생애 누적 추적, 일반과세계좌 내 국내상장 해외 ETF 비중(`1 - overseasRatio`)의 배당보유기간과세(`15.4%` 및 건보료 연동), A값(`2,989,237원/월`) 초과 소득 발생 시 노령연금 감액 옵션화 필요.

---

## 🎯 2. Next Priorities (단기 우선 추진 과제 — P0 / P1 정합성 완결)

> 일일 상태 리포트(`run_daily_digest.py`)는 아래 체크리스트의 상위 미완료 항목(`* [ ]`)을 자동 추출하여 추적합니다.

* [x] **[P0 · 회계 보존 무결성] 국민연금 추납(`applyAdditionalPensionSelf/Spouse`) 일시 납입 원금의 원장 차감 동기화 (`GAP-02`)**: 추납 활성화 시 산출된 일시 납입 원금(`additionalMonths * monthlyContribution`)을 은퇴 전환 시점(`ageSelf === targetRetirementAgeSelf`) 일반과세계좌(`taxable`)에서 정확히 차감하고 `accountingResidual === 0원` 보존 항등식을 유지하도록 보강 완료.
* [x] **[P0 · 공정 비교 회계] 100세 기말 가처분 순자산(`endDisposableNetWorth`)의 개인·법인 대칭 청산세 반영 (`GAP-03`)**: 법인 청산 배당소득세(`resolveCorporateExitNetWorth`)와 대칭되도록 기말 개인 일반과세계좌(`endTaxable`)의 미실현 해외 ETF 양도소득세(`22%`) 및 잔여 연금저축·IRP의 잠재 청산 세금을 `resolvePersonalExitNetWorth`로 일관되게 차감 완료.

---

## 🛠️ 3. Medium-Term Enhancements (중기 상용 가치 고도화 — P2)

* [x] **[P2 · 리포트 내보내기] 1-Click PDF 마스터플랜 리포트 (`Executive Playbook Print/PDF`)**: `② 금융자산 구성 가이드`의 3단계 실행 공식, D-Day 5대 계좌 배치표, 4대 핵심 차트, 연차별 요약 원장을 A4 Landscape 인쇄 규격(`@media print`)으로 원클릭 출력·저장하는 전용 프린트 리포트 레이아웃 제공 완료.
* [x] **[P2 · 가구 생애주기 확장] 비정기 일회성 현금흐름 이벤트 슬롯 (`Lump-Sum Cashflow Events`)**: 자녀 결혼·교육비 지원, 주택담보대출 완납, 상속·증여 유입 등 특정 연령에 발생하는 일회성 목돈 지출/유입 이벤트 슬롯(최대 5개 + 4종 추천 프리셋) 입력 및 원장 반영 완료.
* [x] **[P2 · 세법·데이터 복원력] Stage 4(ISA 누적 비과세 한도) · Stage 7(국내상장 해외ETF 과세) · 국민연금 A값 초과소득 감액 및 법인배당 Gross-Up/건보 절벽 정밀화 (`GAP-06`, `v1.2.12`)**: ISA 생애 누적 비과세 한도 추적, 국내상장 커버드콜·해외지수 ETF 과표배당/매매차익 과세 연동, 2026.06.17 국민연금 소득활동 감액 개편(`A값+200만`) 및 법인배당 10% Gross-Up·지역건보 1,000만 원 절벽·피부양자 3단계 판정 반영 완료.
* [x] **[v1.2.15 스웜 개선 — 2026-10-15] 코드·UX·엔진 3영역 dev↔eval↔cordi 합의 루프** (상세: `FEATURES.md` §22): 2026 법인세 11/22%·별표4 60등급·인별 과세·법인 실현주의/청산 종합과세·피부양자 인별 판정·연도별 MC·강건 권고 비율(B7) / 판정 히어로·반응형·실측 폭 차트·실질/명목 정합·라이브 칩·금액 읽어주기·타이포 하한 / 인증 스로틀·원자 저장·캐시 정책·ErrorBoundary.
* [ ] **[P2 · 스웜 이월 백로그 (한계효용 낮음으로 합의)]**: 연금계좌 납입 세액공제(100세 순자산의 약 0.5%), IRP 연금수령한도 초과 이연퇴직소득 감면율, 법인 잔액 0원 연도의 이월 실현차익 소멸, MC σ 자산구성 연동(현재 12%p 고정·가정 노출), 근로소득세액공제 간이식, owner 세션 재시작 무효화, 정적 자산 gzip, 버튼 이모지 아이콘 일관성. ⚠ 성능 예산: Chrome 4x 스로틀 입력 1회 solve+band 약 100ms(경계) — 원장 호출 추가 시 섭동 캐시 선행 필요.

---

## ⏳ 4. Long-Term Backlog (장기 로드맵 — P3)

* [x] **[P3 · 확률론적 리스크 분석] 결정론적 수익률 민감도 밴드(`±2.0%p`) 및 시드 고정 몬테카를로(`P10 / P50 / P90`) 100세 생존확률 렌즈**: 단일 기대수익률 외에 시드 고정 PRNG(`mulberry32`) 기반 경로 시뮬레이션을 통해 100세 자산 유지 성공 확률(`survivalProbabilityPercent`)과 `P10 / P50 / P90` 및 `±2.0%p` 신뢰구간 밴드를 `Lens 1`에 시각화 완료.
* [ ] **[P3 · 스키마 다이어트] `SimulationInputs` 시뮬레이션 종료 연령(`investmentHorizon`: 85~105세) 가변화 연동**: 고정 100세 종료 대신 기대수명(85~105세) 슬라이더와 `investmentHorizon` 필드를 연동하여 생애주기 길이에 따른 최적 배분(`r*`) 민감도 분석 지원.

---

## ✅ 5. Completed Milestones (완료된 마일스톤 — Phase 1 ~ Phase 24, `v1.2.12`)

* [x] **Phase 1–5: 클린시트 단일 5대 계좌 원장 엔진(`Single Canonical 5-Basket Ledger`) 및 3-렌즈 워크벤치 구축 (`a56c526`)**
  * `IRP` · `ISA` · `개인연금저축` · `일반과세` · `가족법인` 5대 계좌 원장 상태 머신(`src/engine/ledgerKernel.ts`) 및 1원 단위 회계 보존 검증(`accountingResidual === 0`).
  * 황금분할 탐색(`Golden-Section Search`) 최적 비율 솔버(`r*`), 이분탐색 지속가능 월생활비 솔버, 법인 손익분기 진단, 4대 출구·연금 개시 시기·임원 수 매트릭스(`src/engine/optimizer.ts`).
  * 2-Tier 인증(`PasscodeGateModal.tsx`, 게스트 패스코드 + 소유자 PIN) 및 SQLite 읽기 전용 ETF 카탈로그(`server.py`, Port `:8089`).
* [x] **Phase 7–8: 3-App 표준 회계 정렬 (`1-A` ~ `7-A`) 및 실질 구매력 기본 뷰 정착**
  * 성장:배당 가중평균 수익률(`70:30` 기준 `5.40%/년`) 5대 계좌 대칭 적용, 현재 연령(`currentAgeSelf`) 기준 물가상승률(`2.5%`) 누적 연동.
  * 재직기(`isEmployed`) 중 법인 휴면(유지비·임원급여·직장건보 `0원`) 처리, 1인당 `1억 원` ISA 누적 원금 한도 추적, 초과 저축액 `pRatio : cRatio` 분할 적립.
* [x] **Phase 9–10: 10단계 입력 위저드(`InputWizard`) · 실행 가이드(`ActionGuideView`) · 모던 금융 SVG 차트 엔진 (`8945a58`)**
  * 상단 3-모드 스위처(`① 조건 입력 위저드` · `② 금융자산 구성 가이드 & 상세 분석` · `⚡ 전문가 통합 뷰`) 및 4-타일 벤토 분석 레이아웃.
  * Draft-buffered `NumericInput` (입력 중 강제 클램핑 제거), 컴팩트 프리셋 버튼 + 호버 팝오버, Catmull-Rom 스플라인 곡선·세로 그라디언트·플로팅 툴팁·Y축 라벨 잘림 방지(`padL = 104`).
* [x] **Phase 11 (`v1.1.0`): Top-5 엔진 신뢰성 수정 및 1,274종 ETF 포트폴리오 빌더 완성 (`c99bac7`)**
  * 서버 저장/복원 페이로드(`{ inputs }`) 계약 통일, 2026 건보 상수 명문화, 전 구간 고갈 시 `ALL_DEPLETE` 배지 및 타이브레이커 도입.
  * 법인 배당의 임원 근로소득 상위구간 적층 과세 및 익년 건보료 이월(`pendingDividendIncomeForHealth`), 일시금/IRP 법정 퇴직소득세(근속연수 공제·연금수령 30%/40% 감면) 2단 트랙 구현.
  * `src/engine/portfolioPresets.ts` 및 `src/components/EtfPortfolioBuilder.tsx` 신설 (4대 추천 포트폴리오 프리셋 델타 프리뷰, AUM 상위 100종/전종목 탐색기, 상세 모드 가드 배너, `scripts/run_tests.sh` 7대 테스트 스위트 완비).
* [x] **Phase 12 (`v1.2.0`): Standalone GitHub Clone(`main` 브랜치 승격), Step 1~9 위저드 정밀화, 언더워터 원가 보존·비-IRP D-Day 원천징수 및 `🎚️` 파비콘 통일 (`5f9653f`)**
  * **GitHub `main` 기본 브랜치 승격 & Standalone 환경 구성**: `.env.example` 신설, `FINCORP_DISABLE_AUTH=1` 로컬 무인증 즉시 진입, `package.json` (`dev`/`start`/`build`/`test`) 완비.
  * **회계·세무 무결성 결함 교정 (1,831개 시나리오-연차 잔차 0원)**: 하락장 언더워터(`taxable < taxableBasis`) 구간 취득원가 보존 및 원금 회복분 허위 양도세 방지, 무주택/전환 월세(`annualRentOutflow`) 누적 물가연동(`cpiLivingMultiplier`), 비-IRP 퇴직금 일시 수령(`severanceTransferToIrp === false`) 시 D-Day 퇴직소득세 원천징수 즉시 차감, `activeSeniorDelta` 백분율/소수 정규화.
  * **5대 연령순 프리셋 및 Step 1~9 위저드·전문가 튜너 동기화**: 5대 연령별 프리셋(`40->45세 파이어족 싱글`, `45->50세 이른 은퇴`, `50->60세`, `55->60세`, `60->60세`) 재편, Step 3 일반/절세 월 저축액 분리 표시, Step 5 미사용 `IRP 희망월액` 제거 및 예상 퇴직금 메인 노출, Step 6 `irpExpectedReturnRate` 분리 및 **IRP 위험자산 70% 한도 원클릭 계산기** + `<EtfPortfolioBuilder />` 연동, Step 8 배우자 국민연금·본인/배우자 추납 분리·`sell_rent` 전환연령/보증금/월세 및 `downsizedAssessedValue` UI 개방, `FieldHelpBadge` 단일 정본 공유, `🎚️` SVG 파비콘 적용.
* [x] **Phase 13 (`v1.2.1`): 수익률 입력 직관화(`GAP-04`) · 사적연금 개시연령 커널 연동(`GAP-01`) · D-Day 적립 브릿지 · 전문가 차트/원장 영수증 팝업(`GAP-05`) 완성 (Tab 3 전면 반영)**
  * **수익률 입력 UX 직관화 (`InputWizard.tsx`)**: Step 6 메인 카드에 `[📊 요약 비중·수익률 설정]` ↔ `[🧩 추천 포트폴리오 & ETF 직접 구성 (1,274종)]` 2-모드 세그먼트 탭과 가중평균 산출식 배지(`6.0%×70% + 4.0%×30% = 연 5.40%`)를 전면 배치하고, ETF 직접 구성 시 미작동 요약 슬라이더 숨김, Step 4 `NumericInput` 보유 종목 자동 비례 조정, Step 4 중복 그룹 B 제거, Step 10 요약 카드 정밀 반영.
  * **사적연금 개시연령 커널 연동 & D-Day 적립 브릿지 (`ledgerKernel.ts`, `ActionGuideView.tsx`)**: Stage `⑤-1`/`⑤-2`에 `selfPersonalPensionStartAge`·`selfRetirementPensionStartAge` 정식 반영 및 IRP 운용수익분(`pensionPart`) 저율 한도 캡 적용(`1,877개 시나리오-연차 전수 accountingResidual === 0원`), `ActionGuideView` `STEP 02` 5대 계좌 카드에 `현재 잔고 ➔ 재직 중 적립+운용 ➔ 은퇴 D-Day 잔고` 1줄 브릿지 및 `STEP 01` 퇴직금 유입 경로 명시.
  * **차트 & 51개년 원장 전문가 고도화 (`Lens1AllocationTrack.tsx`, `Lens2WaterfallLedger.tsx`)**: 배분 효율 곡선 동적 Y축 스케일링(`[yFloor, yCeil]`), 생애 궤적 5단계 그리드·10년 마커·사적연금 개시연령 수직선, Chart 2 절세계좌 3종(`③ ISA`·`④ 연금저축`·`⑤ IRP`) 범례 분리 및 법인 급여(`#4f46e5`)/배당(`#9333ea`) 색상 구분, Chart 2 8단계 인출 원천 전체 호버 툴팁, 51개년 원장 셀 인라인 브레이크다운(`.ledger-cell-breakdown`) 및 세금·건보 7대 세목 영수증 팝업(`.ledger-why-popover`) 구현.
* [x] **Phase 14 (`v1.2.2`): 위저드 입력 순서 최적화(후보 1) 및 방식 B 듀얼 스코프 KRX 절세·연금 ETF 포트폴리오 빌더 완성**
  * **후보 1(Candidate 1) 입력 흐름 재정렬 (`InputWizard.tsx`)**: `Step 3 일반금융자산` ➔ `Step 4 절세·연금계좌` ➔ `Step 5 은퇴전저축` ➔ `Step 6 목표수익률` 순으로 재구성하여 현재 보유 자산 파악 후 미래 저축과 통합 수익률을 설정하는 자연스러운 멘탈 모델 확립.
  * **방식 B(Method B) 듀얼 스코프 ETF 빌더 (`EtfPortfolioBuilder.tsx`, `portfolioPresets.ts`, `pensionAndEtf.ts`)**: 단일 `<EtfPortfolioBuilder scope="general" | "sheltered" />` 컴포넌트로 일반·법인 계좌(한·미 1,274종)와 절세·연금계좌(KRX 국내상장 전용)를 모두 지원하고, 국내상장 6대 코어 ETF(`360750` S&P500 · `133690` 나스닥100 · `458730` 미국배당다우존스 · `069500` 코스피200 · `292150` 코리아TOP10 · `273130` 국내채권) 조합 5종 전용 추천 프리셋칩(`SHELTERED_PORTFOLIO_PRESETS`) 및 IRP 위험자산 70% 한도 실시간 연동 완비.
* [x] **Phase 15 (`v1.2.3`~`v1.2.4`): 목표수익률 2단계 슬라이드 분리 (`6. 일반·법인 수익률` / `7. 절세·연금 수익률`), 배우자 예상 퇴직금 분리 과세(`spouseExpectedSeverancePay`) 및 Step 3·4 입력 UX 정교화 (`InputWizard.tsx`, `ControlDock.tsx`, `ledgerKernel.ts`, `styles.css`)**
  * **목표수익률 2단계 분리 (10단계 집중 위저드 + Step 11 입력 요약)**: 단일 `6. 목표수익률`의 이중 탭을 **`6. 일반·법인 수익률`**(기본: 성장:배당 슬라이더 + 해외상장 ETF 직접투자 비중, 상세: `<EtfPortfolioBuilder scope="general" />` 4종 추천 프리셋 & 1,274종 탐색기)과 **`7. 절세·연금 수익률`**(기본: 대칭/별도 수익률 탭 + ISA·연금저축·IRP 3계좌 기대수익률 + IRP 70% 한도 자동 계산, 상세: `<EtfPortfolioBuilder scope="sheltered" />` KRX 전용 5종 프리셋)로 분리하여 슬라이드당 1계좌군 집중 입력 달성.
  * **Step 3 상세 옵션 제거 & Step 4 퇴직연금/퇴직금 명확화 및 배우자 예상 퇴직금 분리(`spouseExpectedSeverancePay`)**: `3. 일반금융자산`에서 상세 옵션 서랍을 제거하고 `overseasEtfRatio`를 `6. 일반·법인 수익률` 기본 카드로 이관. `4. 절세·연금계좌`에서 `① 본인 퇴직연금 현재 잔액`(기적립 복리 운용) vs `은퇴 시 추가 수령할 예상 퇴직금`(향후 회사 DC 불입분 + 일시 퇴직금) 차이와 IRP 이체 3대 효과를 명확히 안내하고, 맞벌이 부부의 **배우자 예상 퇴직금(`spouseExpectedSeverancePay`)** 분리 입력을 통해 인별 근속연수공제·누진세율 개별 산출 및 배우자 IRP 저율(연 1,500만 원) 한도 지분(`irpSpouseContrib`)을 정확히 반영. 수동 사적연금 개시연령 입력을 제거하여 만 55세 이후 비과세 소진 시 자동 개시 워터폴로 일원화하고 `.field-help-trigger`에 `flex-shrink: 0; white-space: nowrap;`을 적용해 긴 라벨 옆 `[ⓘ 설명]` 배지 세로 찌그러짐 해결.
* [x] **Phase 16 (`v1.2.4` Phase A~D & UI/UX Polish): 세무·건보 정밀도 감사(`GAP-02`/`GAP-03`·부부 해외주식 500만 공제·4대 세목 영수증), 비정기 일회성 현금흐름 이벤트 슬롯, 1-Click PDF 마스터플랜 리포트, 결정론적 수익률 민감도 밴드(`±2.0%p · P10/P50/P90`) 및 모션 폴리시 완결**
  * **Phase A (Engine Tax & Health Precision Audit)**: 국민연금 추납 원금의 은퇴 전환 시점 차감(`GAP-02`), 100세 기말 개인 일반·연금·IRP 잠재 청산세 대칭 반영(`GAP-03`, `resolvePersonalExitNetWorth`), 부부 합산 시 해외주식 양도세 연 500만 원 기본공제, 51개년 원장 영수증 팝업(`.ledger-why-popover`) 내 개인 소득세 4대 세목(`taxPublicAndDiv`, `taxPrivatePensionAndIrp`, `taxOverseasCapGains`, `taxIsaAndSeveranceLump`) 및 건보 피부양자 적격(`isHealthDependentEligible`) 표시.
  * **Phase B (Lump-Sum Cashflow Events)**: `CashflowInputs.lumpSumEvents`(최대 5개 슬롯 + 교육·결혼·주담대·상속 4종 프리셋 칩) 도입 및 재직기/은퇴기 CPI 연동 원장 통합(`2,471개 시나리오-연차 전수 accountingResidual === 0원` 검증).
  * **Phase C (1-Click PDF Masterplan Report)**: `ActionGuideView` 및 상단 바 원클릭 PDF 리포트 출력(`isPrintMode` 전 렌즈 동시 마운트 + `@media print` A4 Landscape 인쇄 전용 스타일시트).
  * **Phase D (Deterministic Return Sensitivity Band & Survival Probability)**: 외부 패키지 없이 시드 고정 PRNG(`mulberry32`) 기반 `evaluateSensitivityBand`(`±2.0%p` 결정론적 경로 + 25회 샘플링 `P10/P50/P90` 및 100세 생존확률) 모듈 신설 및 `Lens 1` SVG 신뢰구간 밴드 오버레이.
  * **UI/UX Polish (`emil-design-eng` & `design-taste-frontend`)**: 커스텀 베지어 이징 토큰(`--ease-out`, `--ease-in-out`, `--ease-drawer`), 명시적 프로퍼티 트랜지션, `:active:not(:disabled) { transform: scale(0.97); }` 촉각 피드백, 팝오버 `transform-origin` + `@starting-style`, `@media (hover: hover) and (pointer: fine)` 터치 호버 가드 적용.
* [x] **Phase 17 (`v1.2.5` Tab 3 Doc Update Items 1~8): 자산 입력 전 예측치 가드, `[ⓘ 설명]` 팝오버 줄바꿈/우측 정렬 수정, 초기화 확인 모달 & 경고 스타일, 상세 옵션 아코디언 바 하단 이관(Step 2·9 전용) 및 Step 4·5·6·7·8·10 메인 카드 UX 일원화**
  * **항목 1 (점진적 자산 지표 노출)**: Step 1~2에서 자산 미입력 상태의 `100세 예상 세후 순자산` 및 `지속가능 최대 월생활비` 노출을 차단하고, Step 3부터 실시간 순자산 표시 활성화.
  * **항목 2 & 6-a (`[ⓘ 설명]` 팝오버 결함 해결)**: `.field-help-popover`에 `white-space: normal; word-break: keep-all; overflow-wrap: break-word;` 및 `.dock-label-row .field-help-popover { left: auto; right: 0; }` 적용.
  * **항목 3 (초기화 버튼 안전장치)**: `전체 기본값 초기화` 및 `기본값 복원`에 `window.confirm` 가드 및 시맨틱 Red-Rose 경고 스타일(`.wizard-reset-btn`, `.step-reset-btn`) 적용.
  * **항목 4 & 5 (상세 옵션 정리 및 기본 카드 승격)**: Step 4(배우자 절세계좌·퇴직금), Step 5(ISA·연금저축 추가납입), Step 8(하락장 스트레스 시나리오), Step 10(법인 임원수·세율·유지비·청산과세)을 메인 카드로 승격하고, `[⚙️ 상세 입력 옵션]`은 Step 2와 Step 9에만 메인 입력 박스 직하단 아코디언 바(`.wizard-detail-toggle-bar`)로 제공.
  * **항목 6-b, 7, 8 (Step 6·7·10 상호배타적 모드 탭)**: Step 6(`간편 슬라이더 입력` vs `ETF 포트폴리오 입력`), Step 7(1단계 `일반·법인 계좌 동일 적용 (IRP는 70% 위험자산 한도 자동 적용)` vs `절세·연금계좌 수익률 별도 적용` ➔ 2단계 `간편 슬라이더 입력` vs `KRX ETF 포트폴리오 입력`), Step 10(`황금분할 최적해(r*) 자동 적용` vs `개인 : 법인 비율 직접 지정` 선택 시에만 수동 슬라이더 노출) 구현.
* [x] **Phase 18 (`v1.2.6` Tab 3 Follow-Up Items 1~7): 법인 손익분기·트라이모달 판정 동기화, 실질 구매력 생애 세금·건보 할인 통일, 차트 범례 클릭 토글(Y축 자동 스케일링), 궤적 중첩 가시성 및 원장 상단 팝오버 클리핑 해결**
  * **항목 1 & 2 (UI 텍스트·배지 정돈)**: `PrecisionTuners.tsx` 법인 인출 우선순위 옵션의 `(§17②3)` 법률 기호 제거 및 Step 11 입력 요약 카드의 상태/수정 배지(`맞춤 입력됨`, `수정 ✎`) `white-space: nowrap; height: 24px;` 단일 행 고정.
  * **항목 3 (법인 손익분기 진단 ↔ 트라이모달 최적해 판정 일원화)**: `evaluateCorporateBreakEven`(`src/engine/optimizer.ts`)을 51개년 정규 원장(`personal100`, `optimalHybrid`, `corporate100`) 실측 델타와 동기화하여, 손익분기 진단 배지와 트라이모달 최적 하이브리드 권고안 간 모순을 원천 제거.
  * **항목 4 (생애 총 세금·건보·유지비 실질 구매력 할인 통일)**: `viewMode === 'real'` 시 `totalLifetimeTaxAndHealthCost` 및 세금·건보 누적액에 연차별 `discountFactor`를 일관 적용하여 카드 내 실질 구매력 단위 통일.
  * **항목 5 & 6 (인터랙티브 차트 범례 시리즈 토글 & 궤적 레이어 순서 교정)**: `Lens 1` 궤적 차트 및 `Lens 2` 적층/인출 차트의 모든 범례에 클릭 표시/숨김 토글(`.legend-item-btn`) + Y축 자동 재스케일링 적용, `corporate100` 보라색 점선을 `optimalHybrid` 실선 위에 렌더링하여 중첩 구간 가시성 확보.
  * **항목 7 (51개년 원장 상단 행 팝오버 방향 자동 전환)**: 원장 상단 3개 행(`rowIdx < 3`)에 `.ledger-row-top-popover`를 적용해 `.ledger-why-popover`가 아래쪽으로 열리도록 개선하여 스크롤 컨테이너 상단 클리핑 해소.
* [x] **Phase 19 (`v1.2.7` Option A): 2-모드 워크플로우 일원화 (`① 조건 입력 위저드` ↔ `② 금융자산 구성 가이드 & 상세 분석`) 및 레거시 `⚡ 전문가 통합 뷰` / `<ControlDock />` 제거 (~1,240줄 경량화)**
  * 상단 모드를 `wizard` ↔ `guide` 2-모드로 통합(`src/App.tsx`)하고, 위저드와 100% 중복되던 레거시 `<ControlDock />` 컴포넌트 본체(~1,158줄)를 제거(`src/components/ControlDock.tsx`에는 공통 프리미티브 `resolveNumericDraft`, `NumericInput`, `FIELD_HELP_CATALOG`, `FieldHelpBadge`만 보존)하여 이중 유지보수 및 UI 드리프트 위험 원천 제거.
* [x] **Phase 20 (`v1.2.8` UX Heuristic Polish): 모드·탭 전환 상태 보존(`wizardStep`·`selectedTile`), 컨텍스트 원클릭 점프(`onJumpToWizardStep`), Step 11 요약 복귀 동선, 오표기(`좌측 도크`·`§17②3`) 정리 및 체크리스트 `localStorage` 유지**
  * `App.tsx`에서 `wizardStep` 및 `selectedTile` 상태를 유지하여 `① 위저드 ↔ ② 가이드` 전환 시 단계/분석탭 초기화를 방지하고, `ActionGuideView` 상단 요약 컨텍스트 원클릭 Step 점프 및 `Step 11` 개별 항목 수정 후 `[📋 요약 화면으로 돌아가기]` 빠른 복귀 제공.
  * Step 1~10 카드 헤더의 기본값/맞춤값 안내 문구 동적 연동, `Lens3StrategyMatrix`의 삭제된 `"좌측 도크"` 참조 문구 및 잔존 `(§17②3)` 표기 제거, 체크리스트 `localStorage`(`retire_opt_checklist_v1`) 상태 보존, `.sub-option-row` 키보드 접근성(`role="button"`, `tabIndex={0}`) 보강.
* [x] **Phase 21 (`v1.2.9` Hybrid Step-by-Step Result Briefing & 3-Step Top Navigation): `① 조건 입력` ➔ `② 핵심 결과 브리핑 (6단계 집중 슬라이드)` ➔ `③ 상세 분석 & 원장` 하이브리드 아키텍처 완성**
  * 상단 네비게이션을 3단계(`wizard` ➔ `briefing` ➔ `guide`)로 분리하고, `ActionGuideView.tsx` 내부에 중복 계산 없이 공유 렌더 헬퍼(`renderStep1Card`, `renderStep2DdayBox`, `renderStep3Card`) 기반의 6단계 브리핑 슬라이드(`결과 1. 종합 판정` ~ `결과 6. 실행 체크리스트 & 요약`)를 구현.
  * 각 브리핑 슬라이드에서 **`[📊 이 슬라이드의 심층 차트·원장 바로 보기]`** 클릭 시 `③ 상세 분석 & 원장`의 대상 렌즈(`tile1`~`tile4`)로 즉시 점프하도록 연결하고, `③ 상세 분석 & 원장`에서는 4대 분석 타일이 스크롤 없이 최상단에 바로 보이도록 3단계 요약 공식을 접이식 패널로 구성.
* [x] **Phase 22 (`v1.2.10` CFP/PB Expert Review 5-Task Calibration): 리포트 1원 정합성, 99:1 미세분할 실무 통합 가이드, 배우자 지분 IRP 24년 인출 공백 수정 및 10년 연금수령한도 페이싱, 상증세법 제45조의5·가공 인건비 주의 고지, 하방 민감도(`-2%p · P10`) 및 간병비 버퍼 전면 노출**
  * **Task 1 (Report Number Parity)**: `STEP 01` 예상 퇴직금 부부 합산(`본인 + 배우자`) 일치, `Lens 2` 원장 은퇴 전환 행 퇴직금 실질/명목 병기(`1.76억 (명목 1.9억)`), `buildPensionOption` 실질 구매력(`discountFactor`) 적용으로 국민연금 표-카드 1원 단위 일치.
  * **Task 2 (Micro-Split Practical Consolidation Advisory)**: 수학적 최적해(`optimalHybrid >= corporate100`)는 그대로 유지하면서 `VerdictHeader`에 `개인 단독 운용(100%) 대비 세후 +XX억 우위` 기준선을 명시하고, `1~5%` 미세 분할(`차이 < 0.5%` 또는 `< 1,000만 원`) 시 `실무상 법인 100% 통합 권장` 배지 및 `STEP 01` 실무 팁 병기.
  * **Task 3 (IRP Continuity & 10-Year Annuity Pacing)**: `ledgerKernel.ts` Stage `⑤-2` 및 `hhPensionTax`에서 본인 연금저축 인출 시 배우자 IRP 저율 한도(`1,500만`)까지 잠기던 버그를 해결해 60~83세 IRP 인출 단절을 해소하고, 이연퇴직소득 원금 10년 균등 연금수령한도 페이싱 반영(`2,471개 시나리오-연차 전수 accountingResidual === 0원` 유지).
  * **Task 4 (Family Corp Tax Compliance & Book vs Liquidation Net Worth)**: `'자녀 지분 참여 · 가업승계'`를 `'자녀 지분 참여 · 가족법인 지분승계'`로 교정하고 상증세법 제45조의5(특정법인 증여의제) 및 비상근 임원 인건비 부인 리스크 고지 추가, `Lens 2` 원장 우측 컬럼에 `기말 5대 계좌 장부잔액` vs `기말 세후 가처분 순자산 (장부 X − 청산세 Y)` 명시.
  * **Task 5 (Downside Sensitivity & Care Buffer on Slide 1 & Print Mode)**: 브리핑 `결과 1` 슬라이드에 `-2.0%p 보수적 시나리오`, `몬테카를로 하위 10%(P10) · 100세 생존확률`, `후기 노년 케어·간병비 가용 월 여유분` 3열 카드를 상시 노출하고, PDF 리포트 출력(`isPrintMode`) 시 `Lens 1` 수익률 민감도 밴드를 자동 활성화.
* [x] **Phase 23 (`v1.2.11` Unified PDF Button & 4-Part PB Wealth Consulting Masterplan Report): 중복 PDF 버튼 단일화 및 핵심 결과 브리핑(슬라이드 1~6) + 10대 입력 전제조건 + 상세 분석(01~04) 통합 4-Part 컨설팅 북 리포트 개편**
  * **Task 1 (Single Unified PDF Button)**: `ActionGuideView.tsx` 우측 서브 바의 중복 PDF 출력 버튼을 제거하고 `App.tsx` 글로벌 상단 헤더의 `🖨️ PDF 마스터플랜 리포트` 단일 버튼으로 일원화.
  * **Task 2 (4-Part PB/WM Masterplan Report Layout & Print Typography)**: `isPrintMode` 시 기관용 마스트헤드(`.print-report-masthead`), 10대 설계 전제조건 명세표(`PART I-1`), 브리핑 슬라이드 1~4 전체(`PART I-2` & `PART I-3`), `Lens 1` 황금분할·민감도 궤적(`PART II`), `Lens 2` 차트 + 브리핑 슬라이드 5~6 / `Lens 3` 전략·연금·출구·체크리스트(`PART III`), 51개년 전체 원장 표 + 3열 세무·법무·회계오차 0원 보증 푸터(`PART IV`, `.print-report-footer`)를 페이지 브레이크(`.print-page-break`) 및 반복 테이블 헤더와 함께 정밀 조판.
* [x] **Phase 24 (`v1.2.12` 2026 Tax/NHIS Precision & Inline Diagnostics Upgrade): 2026.06.17 국민연금 감액 개편, 법인배당 10% Gross-Up, 지역건보 1,000만 원 절벽·피부양자 3단계 판정, IRP 11년차+ 40% 감면, ISA 누적 비과세, 국내상장 커버드콜 과표배당 및 무클러터(Zero-Clutter) 인라인 진단 & 통합 마스터플랜 CSV 내보내기**
  * **P0/P1 (2026 Tax, NHIS & ETF Tax-Base Precision)**: `calculatePublicPensionWorkReduction`(`A값+200만 = 월 5,193,511원` 미만 감액 폐지), `calculateIndividualCombinedTax`(법인배당 10% Gross-Up 및 배당세액공제, 15.4% 비교과세 하한), `calculateRegionalHealthInsurance`(금융소득 1,000만 원 절벽 및 재산과표 `5.4억/9억` 3단계 피부양자 판정·`dependentIncomeHeadroom`), `ledgerKernel.ts`(IRP 연금개시 11년차+ 40% 퇴직소득세 감면 전환, ISA 생애 누적 비과세 한도 차감, 상세 ETF 모드 국내상장 커버드콜 `taxableDividendRatio` 및 국내기타ETF 매매차익 `krxTaxableGainRatio` 반영 — 2,471개 시나리오-연차 `accountingResidual === 0원` 완벽 보존).
  * **P2/P3 (Zero-Clutter Inline Diagnostics & MasterPlan CSV Export)**: UI 탭/위저드 단계 추가 없이 `Lens3StrategyMatrix` 국민연금 행에 정상수령 대비 누적 수령액 교차 연령(`정상수령 누적교차 X세`) 인라인 표시, `Lens2WaterfallLedger` 세금·건보 호버 팝오버 내 `세법·건보 절벽 여유 한도` 추가, 4대 섹션 통합 `[통합 마스터플랜 CSV]` 내보내기(`handleExportMasterPlanCsv`) 구현.
