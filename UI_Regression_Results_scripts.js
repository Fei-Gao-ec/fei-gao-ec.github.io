// new_scripts.js
// Uses tablesData (from tablesData.js) to categorize and render tables by spec, DV, UI size, and age/gender controls

(function() {
	// ---- Helpers ----
	function normalizeVarName(name) {
		return String(name || '').replace(/[`]/g, '').trim();
	}

	function hasValue(cell) {
		return cell !== undefined && cell !== null && String(cell).trim() !== '';
	}

	function classifyDependent(depVar) {
		const v = String(depVar || '').toLowerCase();
		if (v.includes('wealth_at_end')) return 'wealth';
		if (v.includes('6_months_log')) return '6m_log';
		if (v.includes('6_months')) return '6m';
		if (v.includes('3_months_log')) return '3m_log';
		if (v.includes('3_months')) return '3m';
		return 'other';
	}

	function detectUiSize(table) {
		// Look for specific UI size variables appearing with any non-empty coefficient
		const uiVars = {
			avg_ui_linear: ['Average_monthly_UI_before'],
			avg_ui_log: ['Average_monthly_UI_before_log'],
			median_ui: ['median_daily_ui'],
			median_ui_log: ['median_daily_ui_log']
		};
		const present = new Set();
		(table.data || []).forEach(row => {
			const varName = normalizeVarName(row.variable);
			Object.entries(uiVars).forEach(([key, names]) => {
				if (names.some(n => varName === n)) {
					// If any column has a value for this var, mark present
					if (hasValue(row['(1)']) || hasValue(row['(2)']) || hasValue(row['(3)'])) {
						present.add(key);
					}
				}
			});
		});
		// Prefer a single UI type; if multiple, choose a stable priority
		const priority = ['avg_ui_linear', 'avg_ui_log', 'median_ui', 'median_ui_log'];
		for (const key of priority) {
			if (present.has(key)) return key;
		}
		return null;
	}

	function isIvSecondStage(table) {
		// Presence of Wealth_at_end(fit) indicates IV second stage
		return (table.data || []).some(row => normalizeVarName(row.variable).toLowerCase().includes('wealth_at_end(fit)'.toLowerCase()));
	}

	function classifySpec(table) {
		const dep = classifyDependent(table.dependentVariable);
		if (dep === 'wealth') return 'iv'; // first stage
		if (isIvSecondStage(table)) return 'iv';
		return 'baseline';
	}

	function getColumnsInTable(table) {
		const keys = ['(1)', '(2)', '(3)'];
		const present = [];
		keys.forEach(k => {
			// A column exists if at least one row has content in that column
			const hasCol = (table.data || []).some(r => hasValue(r[k]));
			if (hasCol) present.push(k);
		});
		return present;
	}

	function getColumnControlType(table, colKey) {
		// Determine presence per column
		let age = false, age2 = false, ageSex = false;
		(table.data || []).forEach(row => {
			const v = normalizeVarName(row.variable);
			if (v === 'Age' && hasValue(row[colKey])) age = true;
			if ((v === 'Age2' || v.toLowerCase() === 'age2') && hasValue(row[colKey])) age2 = true;
			if ((v === 'Age:sex2' || v.toLowerCase() === 'age:sex2') && hasValue(row[colKey])) ageSex = true;
		});
		if (!age && !age2 && !ageSex) return 'exclude';
		if (age && !age2 && !ageSex) return 'include';
		if (age && ageSex && !age2) return 'interaction';
		if (age && age2 && !ageSex) return 'age2_control';
		if (age && age2 && ageSex) return 'age2_interaction';
		// Fallback
		return 'include';
	}

	function dvLabel(dep) {
		switch (dep) {
			case '3m': return '3-Month Salary Change Rate';
			case '3m_log': return '3-Month Salary Change Rate (Log)';
			case '6m': return '6-Month Salary Change Rate';
			case '6m_log': return '6-Month Salary Change Rate (Log)';
			case 'wealth': return 'Wealth at end (First Stage)';
			default: return dep;
		}
	}

	function uiLabel(ui) {
		switch (ui) {
			case 'avg_ui_linear': return 'Average Monthly UI';
			case 'avg_ui_log': return 'Average Monthly UI (Log)';
			case 'median_ui': return 'Median Daily UI';
			case 'median_ui_log': return 'Median Daily UI (Log)';
			default: return '';
		}
	}

	function controlLabel(key) {
		switch (key) {
			case 'exclude': return 'Exclude Age';
			case 'include': return 'Include Age';
			case 'interaction': return 'Age × Gender Interaction';
			case 'age2_control': return 'Higher-order Age Control';
			case 'age2_interaction': return 'Higher-order Age Control + Gender Interaction';
			default: return key;
		}
	}

	function getCoefficientColor(coef, se) {
		if (!coef || coef === '') return '';

		const numCoef = parseFloat(coef);
		if (isNaN(numCoef)) return '';

		// Check if coefficient is significant (has asterisks)
		const hasAsterisks = /\*/.test(coef);
		const intensity = hasAsterisks ? '1' : '0.6'; // Full color if significant, half if not

		// Treat "0.00000" as positive since there are no actual zero coefficients
		if (numCoef >= 0) {
			return `rgba(255, 0, 0, ${intensity})`; // Red for positive (including 0.00000)
		} else {
			return `rgba(0, 128, 0, ${intensity})`; // Green for negative
		}
	}

	function getVariableOrder(isIv) {
		// Define baseline basic order in normalized, lower-case names
		const baselineOrder = [
			'duration_ui_before',
			'average_monthly_ui_before',
			'average_monthly_ui_before_log',
			'median_daily_ui_before',
			'median_daily_ui_before_log',
			'median_daily_ui',
			'median_daily_ui_log',
			'ui_group1',
			'ui_group2',
			'ui_group3',
			'wealth_at_end',
			'run_mean_lagged_salary',
			'age',
			'sex2',
			'age2',
			'age:sex2'
		];
		if (isIv) {
			// IV order: IV-specific first, then baseline basic order
			return [
				'wealth_at_end(fit)',
				'amount_scp',
				'amount_lottery_in',
				'amount_lottery_out',
				...baselineOrder
			];
		} else {
			return baselineOrder;
		}
	}

	function sortVariables(variables, isIv) {
		const order = getVariableOrder(isIv);
		const orderedVars = [];
		const otherVars = [];

		variables.forEach(v => {
			const normalized = normalizeVarName(v).toLowerCase();
			if (order.includes(normalized)) {
				orderedVars.push(v);
			} else {
				otherVars.push(v);
			}
		});

		// Sort ordered vars by the predefined order
		orderedVars.sort((a, b) => {
			const aNorm = normalizeVarName(a).toLowerCase();
			const bNorm = normalizeVarName(b).toLowerCase();
			return order.indexOf(aNorm) - order.indexOf(bNorm);
		});

		// Sort other vars alphabetically
		otherVars.sort();

		return [...orderedVars, ...otherVars];
	}

	// ---- Build index of all tables ----
	const indexed = tablesData.map((t, idx) => {
		const spec = classifySpec(t);
		const dep = classifyDependent(t.dependentVariable);
		const ui = detectUiSize(t);
		const cols = getColumnsInTable(t);
		const columnMeta = {};
		cols.forEach(c => { columnMeta[c] = getColumnControlType(t, c); });
		return {
			id: idx + 1,
			spec,
			dep,
			ui,
			columnMeta,
			table: t
		};
	});

	// ---- UI wiring ----
	function getChecked(id) { const el = document.getElementById(id); return !!(el && el.checked); }
	function getSelectValue(id) { const el = document.getElementById(id); return el ? el.value : ''; }

	function selectedDepTypes() {
		const out = new Set();
		if (getChecked('depVar3m')) out.add('3m');
		if (getChecked('depVar3mLog')) out.add('3m_log');
		if (getChecked('depVar6m')) out.add('6m');
		if (getChecked('depVar6mLog')) out.add('6m_log');
		if (getChecked('depVarWealth')) out.add('wealth');
		return out;
	}

	function selectedUiTypes() {
		const out = new Set();
		if (getChecked('uiSizeAvgLinear')) out.add('avg_ui_linear');
		if (getChecked('uiSizeAvgLog')) out.add('avg_ui_log');
		if (getChecked('uiSizeMedian')) out.add('median_ui');
		if (getChecked('uiSizeMedianLog')) out.add('median_ui_log');
		return out;
	}

	function selectedControlTypes() {
		const out = new Set();
		if (getChecked('colExcludeAge')) out.add('exclude');
		if (getChecked('colIncludeAge')) out.add('include');
		if (getChecked('colAgeInteraction')) out.add('interaction');
		if (getChecked('colAge2Control')) out.add('age2_control');
		if (getChecked('colAge2Interaction')) out.add('age2_interaction');
		return out;
	}

	function getIvStageAndSample() {
		const stageFirst = getChecked('ivStageFirst');
		const stageSecond = getChecked('ivStageSecond');
		const subsetWhole = getChecked('ivSubsetWhole');
		const subsetLotteryScp = getChecked('ivSubsetLotteryScp');
		const subsetLotteryOnly = getChecked('ivSubsetLotteryOnly');
		return { stageFirst, stageSecond, subsetWhole, subsetLotteryScp, subsetLotteryOnly };
	}

	function getIvSampleFromObservations(obsText) {
		const obs = parseInt(obsText.replace(/,/g, ''));
		if (obs === 63413) return 'whole';
		if (obs === 17553) return 'lottery_scp';
		if (obs === 6289) return 'lottery_only';
		return 'unknown';
	}

	function getIvStageFromDependent(dep) {
		return dep === 'wealth' ? 'first' : 'second';
	}

	function getSampleLabel(record) {
		// Heuristic: large N (~63k) => full; small N (~17k) => lottery/SCP subset
		const summary = record.table.summary || [];
		const obs = summary.find(s => s.metric && s.metric.toLowerCase().includes('observations'));
		const values = [obs?.value, obs?.value2, obs?.value3]
			.filter(Boolean)
			.map(v => parseInt(String(v).replace(/[^0-9]/g, ''), 10))
			.filter(n => !isNaN(n));
		const maxN = values.length ? Math.max(...values) : 0;
		return maxN >= 60000 ? 'full' : 'lottery';
	}

	function chooseRecord() {
		const specWanted = getSelectValue('mainSpec');
		const depWanted = selectedDepTypes();
		const uiWanted = selectedUiTypes();
		const controlsWanted = selectedControlTypes();

		// Filter records by spec and DV
		let candidates = indexed.filter(r => r.spec === specWanted && depWanted.has(r.dep));

		// Filter by UI if any chosen and record has a UI type; allow through if DV=wealth and no UI detected
		if (uiWanted.size > 0) {
			candidates = candidates.filter(r => !r.ui || uiWanted.has(r.ui) || r.dep === 'wealth');
		}

		// If still multiple, prefer those with UI explicitly matching when DV != wealth
		if (candidates.length > 1 && uiWanted.size > 0) {
			const strict = candidates.filter(r => r.ui && uiWanted.has(r.ui));
			if (strict.length > 0) candidates = strict;
		}

		// Return first match
		return candidates[0] || indexed[0];
	}

	function chooseRecordFor(depName) {
		const specWanted = getSelectValue('mainSpec');
		const uiWanted = selectedUiTypes();
		let candidates = indexed.filter(r => r.spec === specWanted && r.dep === depName);
		if (uiWanted.size > 0 && depName !== 'wealth') {
			const strict = candidates.filter(r => r.ui && uiWanted.has(r.ui));
			if (strict.length > 0) candidates = strict;
		}
		return candidates[0] || null;
	}

	function buildHeaderColumns(record, controlsWanted) {
		const cols = Object.keys(record.columnMeta);
		const filtered = cols.filter(c => controlsWanted.size === 0 || controlsWanted.has(record.columnMeta[c]));
		const finalCols = filtered.length > 0 ? filtered : cols;
		return finalCols.map(c => ({ key: c, label: controlLabel(record.columnMeta[c]) }));
	}

	function renderTable() {
		const specWanted = getSelectValue('mainSpec');
		const isIv = specWanted === 'iv';
		let depSet, uiSet, controlsSet;
		if (isIv) {
			// For IV, use default selections since controls are hidden
			depSet = new Set(['3m']); // Default to 3-month
			uiSet = new Set(); // No UI filtering for IV
			controlsSet = new Set(['include']); // Default to Include Age
		} else {
			depSet = selectedDepTypes();
			uiSet = selectedUiTypes();
			controlsSet = selectedControlTypes();
		}
		const depOrder = ['3m', '3m_log', '6m', '6m_log', 'wealth'];
		let selectedDeps = depOrder.filter(d => depSet.has(d));
		if (isIv) {
			// Default: IV second stage with full data -> dependent variables exclude wealth
			if (selectedDeps.length === 0) {
				selectedDeps = ['3m'];
			}
		}
		const desiredControls = controlsSet.size > 0 ? Array.from(controlsSet) : ['include'];

		if (selectedDeps.length === 0) {
			const thead = document.getElementById('tableHeader');
			const tbody = document.getElementById('tableBody');
			const extra = document.getElementById('extraResults');
			if (thead) thead.innerHTML = '<tr><th>Variable</th></tr>';
			if (tbody) tbody.innerHTML = '';
			if (extra) extra.innerHTML = '';
			return;
		}

		// Build independent columns: for each DV × UI × control (wealth DV ignores UI)
		const columns = [];
		if (isIv) {
			// For IV, filter based on stage and sample selections
			const ivSelections = getIvStageAndSample();
			const ivTables = indexed.filter(r => r.spec === 'iv');
			console.log('Available IV tables:', ivTables);
			console.log('IV selections:', ivSelections);

			ivTables.forEach((table, idx) => {
				const cols = Object.keys(table.columnMeta);
				cols.forEach(colKey => {
					const controlKey = table.columnMeta[colKey];
					// Collect N, R2, Adjusted R2 for this column
					let obsText = '', r2Text = '', adjR2Text = '';
					const summary = table.table.summary || [];
					const obs = summary.find(s => s.metric && s.metric.toLowerCase().includes('observations'));
					const r2 = summary.find(s => s.metric && s.metric.toLowerCase().startsWith('r^2'));
					const adj = summary.find(s => s.metric && s.metric.toLowerCase().includes('adjusted r^2'));
					if (obs) {
						obsText = colKey === '(3)' && obs.value3 ? obs.value3 : colKey === '(2)' && obs.value2 ? obs.value2 : obs.value || '';
					}
					if (r2) {
						r2Text = colKey === '(3)' && r2.value3 ? r2.value3 : colKey === '(2)' && r2.value2 ? r2.value2 : r2.value || '';
					}
					if (adj) {
						adjR2Text = colKey === '(3)' && adj.value3 ? adj.value3 : colKey === '(2)' && adj.value2 ? adj.value2 : adj.value || '';
					}

					// Check if this table matches the selected stage and sample
					const tableStage = getIvStageFromDependent(table.dep);
					const tableSample = getIvSampleFromObservations(obsText);

					const stageMatches = (tableStage === 'first' && ivSelections.stageFirst) ||
										(tableStage === 'second' && ivSelections.stageSecond);

					const sampleMatches = (tableSample === 'whole' && ivSelections.subsetWhole) ||
										(tableSample === 'lottery_scp' && ivSelections.subsetLotteryScp) ||
										(tableSample === 'lottery_only' && ivSelections.subsetLotteryOnly);

					if (stageMatches && sampleMatches) {
						columns.push({
							dep: table.dep,
							control: controlKey,
							ui: table.ui,
							record: table,
							colKey,
							obsText,
							r2Text,
							adjR2Text
						});
					}
				});
			});
		} else {
			// Original logic for Baseline
			selectedDeps.forEach(depName => {
				const uiChoices = depName === 'wealth' ? [null] : (uiSet.size > 0 ? Array.from(uiSet) : [null]);
				uiChoices.forEach(uiChoice => {
					desiredControls.forEach(controlKey => {
						let candidates = indexed.filter(r => r.spec === specWanted && r.dep === depName && (depName === 'wealth' || (uiChoice ? r.ui === uiChoice : true)));

						// Debug logging for IV
						if (isIv) {
							console.log('IV Debug:', {
								specWanted,
								depName,
								controlKey,
								allIvTables: indexed.filter(r => r.spec === 'iv'),
								candidates,
								uiChoice
							});
						}

						// Choose first candidate that actually has the desired control column
						let chosen = null;
						let colKey = null;
						for (const cand of candidates) {
							const entry = Object.entries(cand.columnMeta).find(([, ctl]) => ctl === controlKey);
							if (entry) { chosen = cand; colKey = entry[0]; break; }
						}
						if (!chosen && candidates.length > 0) chosen = candidates[0];
						// Collect N, R2, Adjusted R2 for this column (based on colKey index if present)
						let obsText = '', r2Text = '', adjR2Text = '';
						if (chosen) {
							const summary = chosen.table.summary || [];
							const obs = summary.find(s => s.metric && s.metric.toLowerCase().includes('observations'));
							const r2 = summary.find(s => s.metric && s.metric.toLowerCase().startsWith('r^2'));
							const adj = summary.find(s => s.metric && s.metric.toLowerCase().includes('adjusted r^2'));
							if (obs) {
								obsText = colKey === '(3)' && obs.value3 ? obs.value3 : colKey === '(2)' && obs.value2 ? obs.value2 : obs.value || '';
							}
							if (r2) {
								r2Text = colKey === '(3)' && r2.value3 ? r2.value3 : colKey === '(2)' && r2.value2 ? r2.value2 : r2.value || '';
							}
							if (adj) {
								adjR2Text = colKey === '(3)' && adj.value3 ? adj.value3 : colKey === '(2)' && adj.value2 ? adj.value2 : adj.value || '';
							}
						}
						columns.push({ dep: depName, control: controlKey, ui: uiChoice || (chosen ? chosen.ui : null), record: chosen, colKey, obsText, r2Text, adjR2Text });
					});
				});
			});
		}

		// Build unified variable list across chosen records
		const varSet = new Set();
		columns.forEach(c => {
			if (c.record) {
				(c.record.table.data || []).forEach(row => {
					const nm = normalizeVarName(row.variable);
					if (nm) varSet.add(nm); // exclude empty name rows used for SE
				});
			}
		});
		const variables = sortVariables(Array.from(varSet), isIv);

		// Title: only spec label
		const titleEl = document.getElementById('tableTitle');
		if (titleEl) {
			const specLabel = specWanted === 'iv' ? 'IV Results' : 'Baseline Results';
			titleEl.textContent = specLabel;
		}

		// Hide global badges (N and R² are shown per column now)
		const sampleEl = document.getElementById('sampleSize');
		const r2El = document.getElementById('rSquared');
		if (sampleEl) sampleEl.textContent = '';
		if (r2El) r2El.textContent = '';

		// Table header
		const thead = document.getElementById('tableHeader');
		if (thead) {
			thead.innerHTML = '';
			const tr = document.createElement('tr');
			const thVar = document.createElement('th');
			thVar.textContent = 'Variable';
			tr.appendChild(thVar);
			columns.forEach(c => {
				const th = document.createElement('th');
				const depTxt = dvLabel(c.dep);
				const uiTxt = uiLabel(c.ui);
				const ctlTxt = controlLabel(c.control);
				const title = [depTxt, uiTxt, ctlTxt].filter(Boolean).join(' • ');
				th.textContent = title;
				tr.appendChild(th);
			});
			thead.appendChild(tr);
		}

		// Table body
		const tbody = document.getElementById('tableBody');
		if (tbody) {
			tbody.innerHTML = '';
				variables.forEach(varName => {
				const tr = document.createElement('tr');
				const tdVar = document.createElement('td');
				tdVar.textContent = varName;
				tr.appendChild(tdVar);
				columns.forEach(c => {
					const td = document.createElement('td');
					let html = '';
					if (c.record && c.colKey) {
						const rows = c.record.table.data || [];
						const idx = rows.findIndex(r => normalizeVarName(r.variable) === varName);
						if (idx !== -1) {
							const coef = rows[idx][c.colKey] || '';
							// find next SE row with empty variable name
							let se = '';
							for (let j = idx + 1; j < rows.length; j++) {
								const nm = normalizeVarName(rows[j].variable);
								if (nm) break; // next variable encountered
								const cell = rows[j][c.colKey] || '';
								if (cell && /\(.*\)/.test(cell)) { se = cell; break; }
							}
							if (coef) {
								const color = getCoefficientColor(coef, se);
								const style = color ? `style="color: ${color};"` : '';
								html = `<span ${style}>${coef}</span>${se ? `<div class="small text-muted">${se}</div>` : ''}`;
							}
						}
					}
					td.innerHTML = html; // leave blank if not found
					tr.appendChild(td);
				});
				tbody.appendChild(tr);
			});

				// Append summary rows
				const makeSummaryRow = (label, getter) => {
					const tr = document.createElement('tr');
					const tdLabel = document.createElement('td');
					tdLabel.textContent = label;
					tr.appendChild(tdLabel);
					columns.forEach(c => {
						const td = document.createElement('td');
						td.textContent = getter(c) || '';
						tr.appendChild(td);
					});
					tbody.appendChild(tr);
				};

				makeSummaryRow('Observations', c => c.obsText);
				makeSummaryRow('R^2', c => c.r2Text);
				makeSummaryRow('Adjusted R^2', c => c.adjR2Text);
		}

		// Extra tables for additional DVs
		const extraContainer = document.getElementById('extraResults');
		if (extraContainer) {
			extraContainer.innerHTML = '';
			for (let i = 1; i < deps.length; i++) {
				const rec = chooseRecordFor(deps[i]);
				if (!rec) continue;
				const cols = buildHeaderColumns(rec, controlsWanted);
				const t = rec.table;
				const specLabel = rec.spec === 'iv' ? 'IV' : 'Baseline';
				const titleParts = [`${specLabel} Results`, dvLabel(rec.dep)];
				const uiText = uiLabel(rec.ui);
				if (uiText) titleParts.push(uiText);

				const section = document.createElement('div');
				section.className = 'mt-3';
				section.innerHTML = `
					<h5 class="mb-2">${titleParts.join(' • ')}</h5>
					<div class="table-responsive">
						<table class="table table-striped table-hover">
							<thead class="table-secondary"></thead>
							<tbody></tbody>
						</table>
					</div>
				`;
				extraContainer.appendChild(section);
				const localThead = section.querySelector('thead');
				const localTbody = section.querySelector('tbody');
				if (localThead) {
					const tr = document.createElement('tr');
					const thVar = document.createElement('th');
					thVar.textContent = 'Variable';
					tr.appendChild(thVar);
					cols.forEach(h => {
						const th = document.createElement('th');
						th.textContent = h.label;
						tr.appendChild(th);
					});
					localThead.appendChild(tr);
				}
				if (localTbody) {
					(t.data || []).forEach(row => {
						const tr = document.createElement('tr');
						const tdVar = document.createElement('td');
						tdVar.textContent = normalizeVarName(row.variable);
						tr.appendChild(tdVar);
						cols.forEach(h => {
							const td = document.createElement('td');
							td.textContent = row[h.key] || '';
							tr.appendChild(td);
						});
						localTbody.appendChild(tr);
					});
				}
			}
		}
	}

	// ---- Temporary list ----
	function listAllAvailableTables() { /* removed temporary listing */ }

	function countTotalTables() { return Array.isArray(tablesData) ? tablesData.length : 0; }

	// Wire update button
	document.addEventListener('DOMContentLoaded', function() {
		const btn = document.getElementById('updateTable');
		if (btn) btn.addEventListener('click', renderTable);

		// Ensure at least one checkbox per group
		function ensureGroupHasOne(ids, fallbackId) {
			const anyChecked = ids.some(id => {
				const el = document.getElementById(id);
				return el && el.checked;
			});
			if (!anyChecked) {
				const fb = document.getElementById(fallbackId);
				if (fb) fb.checked = true;
			}
		}

		function addMinOneGuard(ids) {
			ids.forEach(id => {
				const el = document.getElementById(id);
				if (el) {
					el.addEventListener('change', function(e) {
						if (!e.target.checked) {
							const othersChecked = ids.some(otherId => {
								if (otherId === id) return false;
								const other = document.getElementById(otherId);
								return other && other.checked;
							});
							if (!othersChecked) {
								// Prevent unchecking the last one
								e.target.checked = true;
							}
						}
					});
				}
			});
		}

		// Ensure at least one selection in each group
		addMinOneGuard(['depVar3m', 'depVar3mLog', 'depVar6m', 'depVar6mLog', 'depVarWealth']);
		addMinOneGuard(['uiSizeAvgLinear', 'uiSizeAvgLog', 'uiSizeMedian', 'uiSizeMedianLog']);
		addMinOneGuard(['colExcludeAge', 'colIncludeAge', 'colAgeInteraction', 'colAge2Control', 'colAge2Interaction']);
		addMinOneGuard(['ivStageFirst', 'ivStageSecond']);
		addMinOneGuard(['ivSubsetWhole', 'ivSubsetLotteryScp', 'ivSubsetLotteryOnly']);

		const depIds = ['depVar3m','depVar3mLog','depVar6m','depVar6mLog','depVarWealth'];
		const uiIds = ['uiSizeAvgLinear','uiSizeAvgLog','uiSizeMedian','uiSizeMedianLog'];
		const ctrlIds = ['colExcludeAge','colIncludeAge','colAgeInteraction','colAge2Control','colAge2Interaction'];

		// Show/hide IV control panel based on mainSpec
		function updateIvPanelVisibility() {
			const panel = document.getElementById('ivControls');
			const isIv = getSelectValue('mainSpec') === 'iv';
			if (panel) panel.style.display = isIv ? '' : 'none';
			// Wealth DV only for IV
			const wealthRow = document.getElementById('depVarWealth')?.closest('.form-check');
			if (wealthRow) wealthRow.style.display = isIv ? '' : 'none';
			// Baseline groups containers
			const dvBlock = document.getElementById('documentBenchmark')?.closest('.mb-3');
			const uiBlock = document.getElementById('uiSizeAvgLinear')?.closest('.mb-3');
			const ctrlBlock = document.getElementById('colExcludeAge')?.closest('.mb-3');
			if (isIv) {
				// Hide baseline blocks when IV is selected
				if (dvBlock) dvBlock.classList.add('d-none');
				if (uiBlock) uiBlock.classList.add('d-none');
				if (ctrlBlock) ctrlBlock.classList.add('d-none');
				// Default IV toggles: second stage + full data
				const ivFirst = document.getElementById('ivStageFirst');
				const ivSecond = document.getElementById('ivStageSecond');
				const ivWhole = document.getElementById('ivSubsetWhole');
				const ivLottery = document.getElementById('ivSubsetLottery');
				if (ivFirst) ivFirst.checked = false;
				if (ivSecond) ivSecond.checked = true;
				if (ivWhole) ivWhole.checked = true;
				if (ivLottery) ivLottery.checked = false;
				// Uncheck Document Benchmark to avoid confusion
				const doc = document.getElementById('documentBenchmark');
				if (doc) doc.checked = false;
			} else {
				// Show baseline blocks when not IV
				if (dvBlock) dvBlock.classList.remove('d-none');
				if (uiBlock) uiBlock.classList.remove('d-none');
				if (ctrlBlock) ctrlBlock.classList.remove('d-none');
				// Ensure wealth DV unchecked on baseline
				const wealth = document.getElementById('depVarWealth');
				if (wealth) wealth.checked = false;
			}
		}
		const mainSpecEl = document.getElementById('mainSpec');
		if (mainSpecEl) mainSpecEl.addEventListener('change', () => { updateIvPanelVisibility(); renderTable(); });
		updateIvPanelVisibility();

		ensureGroupHasOne(depIds, 'depVar3m');
		ensureGroupHasOne(uiIds, 'uiSizeAvgLinear');
		ensureGroupHasOne(ctrlIds, 'colIncludeAge');

		// Document Benchmark preset
		function applyDocumentBenchmark() {
			// DVs: only 3m
			depIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = (id === 'depVar3m'); });
			// UI: only Average Monthly UI (Linear)
			uiIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = (id === 'uiSizeAvgLinear'); });
			// Controls: only Include Age
			ctrlIds.forEach(id => { const el = document.getElementById(id); if (el) el.checked = (id === 'colIncludeAge'); });
			renderTable();
		}

		const docBench = document.getElementById('documentBenchmark');
		if (docBench) {
			docBench.addEventListener('click', function() { applyDocumentBenchmark(); });
			// Auto-uncheck when selection deviates from benchmark
			function syncDocBenchState() {
				const is3m = document.getElementById('depVar3m')?.checked;
				const noneOtherDv = ['depVar3mLog','depVar6m','depVar6mLog','depVarWealth'].every(id => !document.getElementById(id)?.checked);
				const uiLinear = document.getElementById('uiSizeAvgLinear')?.checked;
				const noOtherUi = ['uiSizeAvgLog','uiSizeMedian','uiSizeMedianLog'].every(id => !document.getElementById(id)?.checked);
				const includeAge = document.getElementById('colIncludeAge')?.checked;
				const noOtherCtrl = ['colExcludeAge','colAgeInteraction','colAge2Control','colAge2Interaction'].every(id => !document.getElementById(id)?.checked);
				const isBenchmark = !!(is3m && noneOtherDv && uiLinear && noOtherUi && includeAge && noOtherCtrl);
				docBench.checked = isBenchmark;
			}
			[...depIds, ...uiIds, ...ctrlIds].forEach(id => {
				const el = document.getElementById(id);
				if (el) el.addEventListener('change', syncDocBenchState);
			});
		}
		// Initial render and list
		listAllAvailableTables();
		renderTable();
		// Expose helpers used by inline script if needed
		window.listAllAvailableTables = listAllAvailableTables;
		window.countTotalTables = countTotalTables;
	});
})();
