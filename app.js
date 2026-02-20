// ===== DERS PROGRAMI YÖNETİM UYGULAMASI =====

(function () {
    'use strict';

    // ===== CONSTANTS =====
    const DAYS_WEEKDAY = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma'];
    const DAYS_WEEKEND = ['Cumartesi', 'Pazar'];
    const ALL_DAYS = [...DAYS_WEEKDAY, ...DAYS_WEEKEND];

    const TIME_SLOTS = [];
    (function generateSlots() {
        let h = 8, m = 30;
        while (h < 17 || (h === 16 && m <= 15)) {
            const sh = String(h).padStart(2, '0');
            const sm = String(m).padStart(2, '0');
            const endM = m + 45;
            let eh = h + Math.floor(endM / 60);
            let em = endM % 60;
            if (eh > 17 || (eh === 17 && em > 0 && h === 16 && m > 15)) break;
            const seh = String(eh).padStart(2, '0');
            const sem = String(em).padStart(2, '0');
            TIME_SLOTS.push({
                start: `${sh}:${sm}`,
                end: `${seh}:${sem}`,
                label: `${sh}:${sm} - ${seh}:${sem}`
            });
            h = eh;
            m = em;
        }
    })();

    const STORAGE_KEYS = {
        classrooms: 'dp_classrooms',
        departments: 'dp_departments',
        courses: 'dp_courses',
        exams: 'dp_exams',
        schedule: 'dp_schedule',
        templates: 'dp_templates'
    };

    // ===== STATE =====
    const state = {
        classrooms: [],
        departments: [],
        courses: [],
        exams: [],
        schedule: [],
        templates: []
    };

    // ===== UTILITY =====
    function uid() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
    }

    function save(key) {
        localStorage.setItem(STORAGE_KEYS[key], JSON.stringify(state[key]));
    }

    function loadAll() {
        Object.keys(STORAGE_KEYS).forEach(k => {
            const raw = localStorage.getItem(STORAGE_KEYS[k]);
            if (raw) {
                try { state[k] = JSON.parse(raw); } catch (e) { state[k] = []; }
            }
        });
    }

    function saveAll() {
        Object.keys(STORAGE_KEYS).forEach(k => save(k));
    }

    function toast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
        el.innerHTML = `<span>${icons[type] || ''}</span><span>${message}</span>`;
        container.appendChild(el);
        setTimeout(() => el.remove(), 3200);
    }

    function timeToMinutes(t) {
        const [h, m] = t.split(':').map(Number);
        return h * 60 + m;
    }

    function minutesToTime(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function getDepartmentName(id) {
        const d = state.departments.find(x => x.id === id);
        return d ? d.name : 'Genel';
    }

    function getDepartmentCode(id) {
        const d = state.departments.find(x => x.id === id);
        return d ? d.code : '-';
    }

    function getCourseName(id) {
        const c = state.courses.find(x => x.id === id);
        return c ? c.name : '?';
    }

    function getClassroomName(id) {
        const c = state.classrooms.find(x => x.id === id);
        return c ? c.name : '?';
    }

    // ===== COLLISION DETECTION =====
    function hasConflict(classroomId, day, startTime, endTime, excludeId = null) {
        const newStart = timeToMinutes(startTime);
        const newEnd = timeToMinutes(endTime);

        // Check schedule entries
        for (const entry of state.schedule) {
            if (excludeId && entry.id === excludeId) continue;
            if (entry.classroomId !== classroomId || entry.day !== day) continue;
            const eStart = timeToMinutes(entry.startTime);
            const eEnd = timeToMinutes(entry.endTime);
            if (newStart < eEnd && newEnd > eStart) return true;
        }

        // Check exams
        for (const exam of state.exams) {
            if (excludeId && exam.id === excludeId) continue;
            if (exam.classroomId !== classroomId || exam.day !== day) continue;
            const eStart = timeToMinutes(exam.startTime);
            const eEnd = eStart + exam.duration;
            if (newStart < eEnd && newEnd > eStart) return true;
        }

        return false;
    }

    // Check if instructor has a conflict at a given time
    function hasInstructorConflict(instructor, day, startTime, endTime, excludeId = null) {
        const newStart = timeToMinutes(startTime);
        const newEnd = timeToMinutes(endTime);

        for (const entry of state.schedule) {
            if (excludeId && entry.id === excludeId) continue;
            if (entry.day !== day) continue;
            const course = state.courses.find(c => c.id === entry.courseId);
            if (!course || course.instructor !== instructor) continue;
            const eStart = timeToMinutes(entry.startTime);
            const eEnd = timeToMinutes(entry.endTime);
            if (newStart < eEnd && newEnd > eStart) return true;
        }

        for (const exam of state.exams) {
            if (excludeId && exam.id === excludeId) continue;
            if (exam.day !== day) continue;
            const course = state.courses.find(c => c.id === exam.courseId);
            if (!course || course.instructor !== instructor) continue;
            const eStart = timeToMinutes(exam.startTime);
            const eEnd = eStart + exam.duration;
            if (newStart < eEnd && newEnd > eStart) return true;
        }

        return false;
    }

    // ===== FIND AVAILABLE CLASSROOMS =====
    function findAvailableClassrooms(day, startTime, endTime, minCapacity = 0, preferredDept = '') {
        const results = [];

        for (const cr of state.classrooms) {
            if (cr.capacity < minCapacity) continue;
            if (hasConflict(cr.id, day, startTime, endTime)) continue;

            const score = calculateClassroomScore(cr, minCapacity, preferredDept);
            results.push({ classroom: cr, score });
        }

        // Sort: higher score first (best fit)
        results.sort((a, b) => b.score - a.score);
        return results;
    }

    function calculateClassroomScore(classroom, neededCapacity, preferredDept) {
        let score = 100;

        // Prefer exact capacity match (penalize over-capacity)
        const overCapacity = classroom.capacity - neededCapacity;
        if (overCapacity >= 0) {
            score -= overCapacity * 0.5; // Small penalty for too big
        } else {
            score -= 1000; // Major penalty for too small
        }

        // Bonus if same department
        if (preferredDept && classroom.department === preferredDept) {
            score += 20;
        }

        return score;
    }

    // ===== AUTO SCHEDULE =====
    function autoSchedule() {
        const unscheduled = state.courses.filter(c => {
            const scheduled = state.schedule.filter(s => s.courseId === c.id);
            const totalScheduled = scheduled.length; // Each entry = 1 slot = 45 min = 1 hour
            return totalScheduled < c.weeklyHours;
        });

        if (unscheduled.length === 0) {
            toast('Tüm dersler zaten yerleştirilmiş!', 'info');
            return;
        }

        let placed = 0;

        for (const course of unscheduled) {
            const scheduled = state.schedule.filter(s => s.courseId === course.id);
            const remaining = course.weeklyHours - scheduled.length;

            for (let i = 0; i < remaining; i++) {
                const result = findBestSlot(course);
                if (result) {
                    state.schedule.push({
                        id: uid(),
                        type: 'course',
                        courseId: course.id,
                        classroomId: result.classroom.id,
                        day: result.day,
                        startTime: result.slot.start,
                        endTime: result.slot.end
                    });
                    placed++;
                }
            }
        }

        if (placed > 0) {
            save('schedule');
            toast(`${placed} ders saati otomatik yerleştirildi!`, 'success');
            renderSchedule();
            updateStats();
        } else {
            toast('Uygun boş yer bulunamadı!', 'warning');
        }
    }

    function findBestSlot(course) {
        // Try weekdays first, then weekends
        const days = [...DAYS_WEEKDAY, ...DAYS_WEEKEND];

        let bestResult = null;
        let bestScore = -Infinity;

        for (const day of days) {
            // Count existing entries for this course on this day
            const dayEntries = state.schedule.filter(s => s.courseId === course.id && s.day === day);
            if (dayEntries.length >= 2) continue; // Max 2 slots per day

            for (const slot of TIME_SLOTS) {
                // Check classroom availability
                const available = findAvailableClassrooms(
                    day, slot.start, slot.end,
                    course.studentCount, course.department
                );

                if (available.length === 0) continue;

                // Check instructor conflict
                if (hasInstructorConflict(course.instructor, day, slot.start, slot.end)) continue;

                const topResult = available[0];
                // Prefer earlier in the week, morning slots, and fewer entries on same day
                let score = topResult.score;
                score -= days.indexOf(day) * 2; // Prefer earlier days
                score -= dayEntries.length * 10; // Prefer distributing across days
                const slotIdx = TIME_SLOTS.indexOf(slot);
                score -= slotIdx * 0.3; // Slight preference for earlier slots

                if (score > bestScore) {
                    bestScore = score;
                    bestResult = { classroom: topResult.classroom, day, slot };
                }
            }
        }

        return bestResult;
    }

    // ===== UPDATE STATS =====
    function updateStats() {
        document.getElementById('statClassrooms').textContent = state.classrooms.length;
        document.getElementById('statDepartments').textContent = state.departments.length;
        document.getElementById('statCourses').textContent = state.courses.length;
        document.getElementById('statExams').textContent = state.exams.length;
        document.getElementById('statScheduled').textContent = state.schedule.length;
    }

    // ===== TAB NAVIGATION =====
    function initTabs() {
        const btns = document.querySelectorAll('.tab-btn');
        btns.forEach(btn => {
            btn.addEventListener('click', () => {
                btns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
                const tab = document.getElementById(`tab-${btn.dataset.tab}`);
                if (tab) tab.classList.add('active');

                // Refresh data when switching tabs
                if (btn.dataset.tab === 'schedule') {
                    renderSchedule();
                    populateManualSelects();
                }
            });
        });
    }

    // ===== POPULATE SELECTS =====
    function populateDepartmentSelects() {
        const selects = [
            document.getElementById('classroomDepartment'),
            document.getElementById('courseDepartment'),
            document.getElementById('scheduleFilterDepartment'),
            document.getElementById('studentScheduleDepartment')
        ];

        selects.forEach(sel => {
            if (!sel) return;
            const val = sel.value;
            const firstOption = sel.querySelector('option:first-child');
            sel.innerHTML = '';
            if (firstOption) sel.appendChild(firstOption);
            state.departments.forEach(d => {
                const opt = document.createElement('option');
                opt.value = d.id;
                opt.textContent = `${d.code} - ${d.name}`;
                sel.appendChild(opt);
            });
            sel.value = val;
        });
    }

    function populateClassroomSelects() {
        const selects = [
            document.getElementById('examClassroom'),
            document.getElementById('manualClassroom'),
            document.getElementById('scheduleFilterClassroom')
        ];

        selects.forEach(sel => {
            if (!sel) return;
            const val = sel.value;
            const firstOption = sel.querySelector('option:first-child');
            sel.innerHTML = '';
            if (firstOption) sel.appendChild(firstOption);
            state.classrooms.forEach(cr => {
                const opt = document.createElement('option');
                opt.value = cr.id;
                opt.textContent = `${cr.name} (${cr.capacity} kişi)`;
                sel.appendChild(opt);
            });
            sel.value = val;
        });
    }

    function populateCourseSelects() {
        const selects = [
            document.getElementById('examCourse'),
            document.getElementById('manualCourse')
        ];

        selects.forEach(sel => {
            if (!sel) return;
            const val = sel.value;
            const firstOption = sel.querySelector('option:first-child');
            sel.innerHTML = '';
            if (firstOption) sel.appendChild(firstOption);
            state.courses.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = `${c.name} (${c.instructor})`;
                sel.appendChild(opt);
            });
            sel.value = val;
        });
    }

    function populateTimeSlotSelects() {
        const sel = document.getElementById('manualStartTime');
        if (!sel) return;
        sel.innerHTML = '';
        TIME_SLOTS.forEach(slot => {
            const opt = document.createElement('option');
            opt.value = slot.start;
            opt.textContent = slot.label;
            sel.appendChild(opt);
        });
    }

    function populateManualSelects() {
        populateCourseSelects();
        populateClassroomSelects();
        populateTimeSlotSelects();
    }

    // ===== RENDER: CLASSROOMS =====
    function renderClassrooms() {
        const tbody = document.getElementById('classroomTableBody');
        const empty = document.getElementById('classroomEmpty');
        tbody.innerHTML = '';

        if (state.classrooms.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        state.classrooms.forEach(cr => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td><strong>${cr.name}</strong></td>
        <td><span class="badge badge-teal">${cr.capacity} kişi</span></td>
        <td>${cr.department ? getDepartmentName(cr.department) : '<span style="color:var(--text-muted)">Genel</span>'}</td>
        <td>${cr.features.length > 0 ? cr.features.map(f => `<span class="badge badge-purple">${f}</span>`).join(' ') : '-'}</td>
        <td class="actions">
          <button class="btn btn-danger btn-sm" onclick="App.deleteClassroom('${cr.id}')">🗑️</button>
        </td>
      `;
            tbody.appendChild(tr);
        });
    }

    // ===== RENDER: DEPARTMENTS =====
    function renderDepartments() {
        const tbody = document.getElementById('departmentTableBody');
        const empty = document.getElementById('departmentEmpty');
        tbody.innerHTML = '';

        if (state.departments.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        state.departments.forEach(d => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td><strong>${d.name}</strong></td>
        <td><span class="badge badge-yellow">${d.code}</span></td>
        <td class="actions">
          <button class="btn btn-danger btn-sm" onclick="App.deleteDepartment('${d.id}')">🗑️</button>
        </td>
      `;
            tbody.appendChild(tr);
        });
    }

    // ===== RENDER: COURSES =====
    function renderCourses() {
        const tbody = document.getElementById('courseTableBody');
        const empty = document.getElementById('courseEmpty');
        tbody.innerHTML = '';

        if (state.courses.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        state.courses.forEach(c => {
            const scheduled = state.schedule.filter(s => s.courseId === c.id).length;
            const statusBadge = scheduled >= c.weeklyHours
                ? `<span class="badge badge-teal">✅ Tamamlandı (${scheduled}/${c.weeklyHours})</span>`
                : `<span class="badge badge-danger">⏳ ${scheduled}/${c.weeklyHours}</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td><strong>${c.name}</strong></td>
        <td>${c.instructor}</td>
        <td>${c.department ? getDepartmentName(c.department) : '-'}</td>
        <td>${c.year || 1}. Sınıf</td>
        <td>${c.weeklyHours} saat</td>
        <td>${c.studentCount}</td>
        <td>${statusBadge}</td>
        <td class="actions">
          <button class="btn btn-danger btn-sm" onclick="App.deleteCourse('${c.id}')">🗑️</button>
        </td>
      `;
            tbody.appendChild(tr);
        });
    }

    // ===== RENDER: EXAMS =====
    function renderExams() {
        const tbody = document.getElementById('examTableBody');
        const empty = document.getElementById('examEmpty');
        tbody.innerHTML = '';

        if (state.exams.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        state.exams.forEach(ex => {
            const endMin = timeToMinutes(ex.startTime) + ex.duration;
            const endTime = minutesToTime(endMin);
            const tr = document.createElement('tr');
            tr.innerHTML = `
        <td><strong>${getCourseName(ex.courseId)}</strong></td>
        <td>${ex.day}</td>
        <td>${ex.startTime} - ${endTime}</td>
        <td>${ex.duration} dk</td>
        <td><span class="badge badge-purple">${getClassroomName(ex.classroomId)}</span></td>
        <td>${ex.date || '-'}</td>
        <td class="actions">
          <button class="btn btn-danger btn-sm" onclick="App.deleteExam('${ex.id}')">🗑️</button>
        </td>
      `;
            tbody.appendChild(tr);
        });
    }

    // ===== RENDER: SCHEDULE =====
    function renderSchedule() {
        renderCourseSchedule();
        renderExamSchedule();
    }

    function renderCourseSchedule() {
        const container = document.getElementById('courseScheduleContainer');
        if (!container) return;
        renderScheduleTable(container, 'course');
    }

    function renderExamSchedule() {
        const container = document.getElementById('examScheduleContainer');
        if (!container) return;
        renderScheduleTable(container, 'exam');
    }

    function renderScheduleTable(container, type) {
        const viewMode = document.getElementById('scheduleView').value;
        const filterClassroom = document.getElementById('scheduleFilterClassroom').value;
        const filterDepartment = document.getElementById('scheduleFilterDepartment').value;

        container.innerHTML = '';

        let classrooms = [...state.classrooms];
        if (filterClassroom !== 'all') {
            classrooms = classrooms.filter(c => c.id === filterClassroom);
        }
        if (filterDepartment !== 'all') {
            classrooms = classrooms.filter(c => c.department === filterDepartment || !c.department);
        }

        if (classrooms.length === 0) {
            const label = type === 'course' ? 'ders' : 'sınav';
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">${type === 'course' ? '📚' : '�'}</div><p>Gösterilecek ${label} yok</p></div>`;
            return;
        }

        // Check if there is any data of this type
        const hasData = type === 'course'
            ? state.schedule.length > 0
            : state.exams.length > 0;

        if (!hasData) {
            const label = type === 'course' ? 'Henüz ders yerleştirilmedi' : 'Henüz sınav eklenmedi';
            container.innerHTML = `<div class="empty-state"><div class="empty-icon">${type === 'course' ? '📚' : '📝'}</div><p>${label}</p></div>`;
            return;
        }

        classrooms.forEach(cr => {
            // Check if this classroom has any events of this type
            const hasEvents = type === 'course'
                ? state.schedule.some(s => s.classroomId === cr.id)
                : state.exams.some(e => e.classroomId === cr.id);

            if (!hasEvents) return;

            const section = document.createElement('div');
            section.style.marginBottom = '28px';

            const title = document.createElement('h3');
            title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:10px;color:var(--accent-2);';
            title.textContent = `🏫 ${cr.name} (${cr.capacity} kişi)`;
            section.appendChild(title);

            let days = [];
            if (viewMode === 'weekday') days = DAYS_WEEKDAY;
            else if (viewMode === 'weekend') days = DAYS_WEEKEND;
            else days = ALL_DAYS;

            if (days.length === 0) {
                section.innerHTML += '<p style="color:var(--text-muted)">Bu görünümde gösterilecek gün yok.</p>';
                container.appendChild(section);
                return;
            }

            const wrapper = document.createElement('div');
            wrapper.className = 'schedule-wrapper';

            const table = document.createElement('table');
            table.className = 'schedule-table';

            // Header
            const thead = document.createElement('thead');
            let headerHTML = '<tr><th>Saat</th>';
            days.forEach(d => { headerHTML += `<th>${d}</th>`; });
            headerHTML += '</tr>';
            thead.innerHTML = headerHTML;
            table.appendChild(thead);

            // Body
            const tbody = document.createElement('tbody');
            TIME_SLOTS.forEach(slot => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${slot.start}<br><small style="opacity:0.6">${slot.end}</small></td>`;

                days.forEach(day => {
                    const td = document.createElement('td');
                    const events = getEventsForSlotByType(cr.id, day, slot.start, slot.end, type);
                    events.forEach(ev => {
                        const chip = document.createElement('div');
                        chip.className = `schedule-event ${ev.type}`;
                        if (ev.type === 'course') {
                            const course = state.courses.find(c => c.id === ev.courseId);
                            chip.innerHTML = `<span class="event-name">${course ? course.name : '?'}</span><span class="event-detail">${course ? course.instructor : ''}</span>`;
                            chip.title = `${course?.name} - ${course?.instructor}\n${slot.label}`;
                            chip.onclick = () => showEventDetail(ev);
                        } else if (ev.type === 'exam') {
                            const course = state.courses.find(c => c.id === ev.courseId);
                            chip.innerHTML = `<span class="event-name">📝 ${course ? course.name : '?'}</span><span class="event-detail">SINAV (${ev.duration} dk)</span>`;
                            chip.title = `SINAV: ${course?.name}\n${ev.startTime} - ${minutesToTime(timeToMinutes(ev.startTime) + ev.duration)}`;
                        }
                        td.appendChild(chip);
                    });
                    tr.appendChild(td);
                });

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            wrapper.appendChild(table);
            section.appendChild(wrapper);
            container.appendChild(section);
        });
    }

    function getEventsForSlotByType(classroomId, day, slotStart, slotEnd, type) {
        const events = [];
        const sStart = timeToMinutes(slotStart);
        const sEnd = timeToMinutes(slotEnd);

        if (type === 'course') {
            state.schedule.forEach(entry => {
                if (entry.classroomId !== classroomId || entry.day !== day) return;
                const eStart = timeToMinutes(entry.startTime);
                const eEnd = timeToMinutes(entry.endTime);
                if (sStart < eEnd && sEnd > eStart) {
                    events.push({ ...entry, type: 'course' });
                }
            });
        } else if (type === 'exam') {
            state.exams.forEach(exam => {
                if (exam.classroomId !== classroomId || exam.day !== day) return;
                const eStart = timeToMinutes(exam.startTime);
                const eEnd = eStart + exam.duration;
                if (sStart < eEnd && sEnd > eStart) {
                    events.push({ ...exam, type: 'exam' });
                }
            });
        }

        return events;
    }

    function showEventDetail(entry) {
        const course = state.courses.find(c => c.id === entry.courseId);
        const classroom = state.classrooms.find(c => c.id === entry.classroomId);

        showModal(
            `📌 ${course?.name || '?'}`,
            `
        <div style="display:grid;gap:10px;font-size:0.9rem;">
          <div><strong>Öğretim Görevlisi:</strong> ${course?.instructor || '-'}</div>
          <div><strong>Gün:</strong> ${entry.day}</div>
          <div><strong>Saat:</strong> ${entry.startTime} - ${entry.endTime}</div>
          <div><strong>Derslik:</strong> ${classroom?.name || '-'}</div>
          <div><strong>Bölüm:</strong> ${course?.department ? getDepartmentName(course.department) : 'Genel'}</div>
        </div>
      `,
            [
                { text: '🗑️ Kaldır', class: 'btn btn-danger btn-sm', action: () => { removeScheduleEntry(entry.id); closeModal(); } },
                { text: 'Kapat', class: 'btn btn-primary btn-sm', action: closeModal }
            ]
        );
    }

    function removeScheduleEntry(id) {
        state.schedule = state.schedule.filter(s => s.id !== id);
        save('schedule');
        renderSchedule();
        renderCourses();
        updateStats();
        toast('Ders programdan kaldırıldı', 'info');
    }

    // ===== RENDER: TEMPLATES =====
    function renderTemplates() {
        const container = document.getElementById('templateList');
        const empty = document.getElementById('templateEmpty');
        container.innerHTML = '';

        if (state.templates.length === 0) {
            empty.style.display = 'block';
            return;
        }
        empty.style.display = 'none';

        state.templates.forEach(t => {
            const item = document.createElement('div');
            item.className = 'template-item';
            item.innerHTML = `
        <div class="template-info">
          <h4>📄 ${t.name}</h4>
          <small>${t.description || 'Açıklama yok'} • ${t.date} • ${t.data.schedule.length} ders, ${t.data.exams.length} sınav</small>
        </div>
        <div class="btn-group">
          <button class="btn btn-success btn-sm" onclick="App.loadTemplate('${t.id}')">📥 Yükle</button>
          <button class="btn btn-danger btn-sm" onclick="App.deleteTemplate('${t.id}')">🗑️</button>
        </div>
      `;
            container.appendChild(item);
        });
    }

    // ===== MODAL =====
    function showModal(title, bodyHTML, actions = []) {
        document.getElementById('modalTitle').innerHTML = title;
        document.getElementById('modalBody').innerHTML = bodyHTML;
        const actionsDiv = document.getElementById('modalActions');
        actionsDiv.innerHTML = '';
        actions.forEach(a => {
            const btn = document.createElement('button');
            btn.className = a.class || 'btn btn-primary btn-sm';
            btn.textContent = a.text;
            btn.addEventListener('click', a.action);
            actionsDiv.appendChild(btn);
        });
        document.getElementById('modalOverlay').classList.add('active');
    }

    function closeModal() {
        document.getElementById('modalOverlay').classList.remove('active');
    }

    // ===== CRUD: CLASSROOMS =====
    function addClassroom() {
        const name = document.getElementById('classroomName').value.trim();
        const capacity = parseInt(document.getElementById('classroomCapacity').value);
        const department = document.getElementById('classroomDepartment').value;
        const features = document.getElementById('classroomFeatures').value.trim()
            .split(',').map(f => f.trim()).filter(Boolean);

        if (!name) return toast('Derslik adı giriniz!', 'error');
        if (!capacity || capacity < 1) return toast('Geçerli bir kapasite giriniz!', 'error');
        if (state.classrooms.some(c => c.name.toLowerCase() === name.toLowerCase())) {
            return toast('Bu isimde bir derslik zaten var!', 'error');
        }

        state.classrooms.push({ id: uid(), name, capacity, department, features });
        save('classrooms');
        renderClassrooms();
        populateClassroomSelects();
        updateStats();

        document.getElementById('classroomName').value = '';
        document.getElementById('classroomCapacity').value = '';
        document.getElementById('classroomFeatures').value = '';
        toast(`"${name}" dersliği eklendi!`);
    }

    function deleteClassroom(id) {
        const cr = state.classrooms.find(c => c.id === id);
        if (!cr) return;

        // Check if classroom is in use
        const inUse = state.schedule.some(s => s.classroomId === id) || state.exams.some(e => e.classroomId === id);
        if (inUse) {
            showModal('⚠️ Uyarı', `<p>"${cr.name}" dersliği programda kullanılıyor. Silmek istediğinizden emin misiniz? İlgili program kayıtları da silinecek.</p>`, [
                { text: 'Sil', class: 'btn btn-danger btn-sm', action: () => { forceDeleteClassroom(id); closeModal(); } },
                { text: 'İptal', class: 'btn btn-primary btn-sm', action: closeModal }
            ]);
            return;
        }

        forceDeleteClassroom(id);
    }

    function forceDeleteClassroom(id) {
        const cr = state.classrooms.find(c => c.id === id);
        state.classrooms = state.classrooms.filter(c => c.id !== id);
        state.schedule = state.schedule.filter(s => s.classroomId !== id);
        state.exams = state.exams.filter(e => e.classroomId !== id);
        save('classrooms');
        save('schedule');
        save('exams');
        renderClassrooms();
        populateClassroomSelects();
        updateStats();
        toast(`"${cr?.name}" silindi`, 'info');
    }

    // ===== CRUD: DEPARTMENTS =====
    function addDepartment() {
        const name = document.getElementById('departmentName').value.trim();
        const code = document.getElementById('departmentCode').value.trim().toUpperCase();

        if (!name) return toast('Bölüm adı giriniz!', 'error');
        if (!code) return toast('Bölüm kodu giriniz!', 'error');
        if (state.departments.some(d => d.code === code)) {
            return toast('Bu kodda bir bölüm zaten var!', 'error');
        }

        state.departments.push({ id: uid(), name, code });
        save('departments');
        renderDepartments();
        populateDepartmentSelects();
        updateStats();

        document.getElementById('departmentName').value = '';
        document.getElementById('departmentCode').value = '';
        toast(`"${name}" bölümü eklendi!`);
    }

    function deleteDepartment(id) {
        const d = state.departments.find(x => x.id === id);
        state.departments = state.departments.filter(x => x.id !== id);
        save('departments');
        renderDepartments();
        populateDepartmentSelects();
        updateStats();
        toast(`"${d?.name}" silindi`, 'info');
    }

    // ===== CRUD: COURSES =====
    function addCourse() {
        const name = document.getElementById('courseName').value.trim();
        const instructor = document.getElementById('courseInstructor').value.trim();
        const department = document.getElementById('courseDepartment').value;
        const weeklyHours = parseInt(document.getElementById('courseWeeklyHours').value);
        const studentCount = parseInt(document.getElementById('courseStudentCount').value);
        const year = parseInt(document.getElementById('courseYear').value) || 1;

        if (!name) return toast('Ders adı giriniz!', 'error');
        if (!instructor) return toast('Öğretim görevlisi giriniz!', 'error');
        if (!weeklyHours || weeklyHours < 1) return toast('Haftalık saat giriniz!', 'error');
        if (!studentCount || studentCount < 1) return toast('Öğrenci sayısı giriniz!', 'error');

        state.courses.push({ id: uid(), name, instructor, department, weeklyHours, studentCount, year });
        save('courses');
        renderCourses();
        populateCourseSelects();
        updateStats();

        document.getElementById('courseName').value = '';
        document.getElementById('courseInstructor').value = '';
        document.getElementById('courseWeeklyHours').value = '';
        document.getElementById('courseStudentCount').value = '';
        toast(`"${name}" dersi eklendi!`);
    }

    function deleteCourse(id) {
        const c = state.courses.find(x => x.id === id);
        // Remove related schedule entries
        state.schedule = state.schedule.filter(s => s.courseId !== id);
        state.exams = state.exams.filter(e => e.courseId !== id);
        state.courses = state.courses.filter(x => x.id !== id);
        save('courses');
        save('schedule');
        save('exams');
        renderCourses();
        populateCourseSelects();
        renderSchedule();
        updateStats();
        toast(`"${c?.name}" silindi`, 'info');
    }

    // ===== CRUD: EXAMS =====
    function addExam() {
        const courseId = document.getElementById('examCourse').value;
        const day = document.getElementById('examDay').value;
        const startTime = document.getElementById('examStartTime').value;
        const duration = parseInt(document.getElementById('examDuration').value);
        let classroomId = document.getElementById('examClassroom').value;
        const date = document.getElementById('examDate').value;

        if (!courseId) return toast('Ders seçiniz!', 'error');
        if (!startTime) return toast('Başlangıç saati giriniz!', 'error');
        if (!duration || duration < 15) return toast('Geçerli bir süre giriniz!', 'error');

        const endTime = minutesToTime(timeToMinutes(startTime) + duration);

        // Auto-assign classroom if not selected
        if (!classroomId) {
            const course = state.courses.find(c => c.id === courseId);
            const available = findAvailableClassrooms(day, startTime, endTime, course?.studentCount || 0, course?.department || '');
            if (available.length === 0) {
                return toast('Bu zaman diliminde uygun derslik bulunamadı!', 'error');
            }
            classroomId = available[0].classroom.id;
            toast(`Otomatik atandı: ${available[0].classroom.name}`, 'info');
        } else {
            // Check conflict
            if (hasConflict(classroomId, day, startTime, endTime)) {
                return toast('Bu derslik ve zaman diliminde çakışma var!', 'error');
            }
        }

        state.exams.push({ id: uid(), courseId, day, startTime, duration, classroomId, date, isFixed: true });
        save('exams');
        renderExams();
        renderSchedule();
        updateStats();
        toast('Sınav eklendi!');
    }

    function deleteExam(id) {
        state.exams = state.exams.filter(e => e.id !== id);
        save('exams');
        renderExams();
        renderSchedule();
        updateStats();
        toast('Sınav silindi', 'info');
    }

    // ===== EXAM SUGGESTIONS =====
    function showExamSuggestions() {
        const courseId = document.getElementById('examCourse').value;
        const day = document.getElementById('examDay').value;
        const startTime = document.getElementById('examStartTime').value;
        const duration = parseInt(document.getElementById('examDuration').value) || 90;

        if (!courseId || !startTime) return;

        const course = state.courses.find(c => c.id === courseId);
        const endTime = minutesToTime(timeToMinutes(startTime) + duration);
        const available = findAvailableClassrooms(day, startTime, endTime, course?.studentCount || 0, course?.department || '');

        const box = document.getElementById('examSuggestions');
        const list = document.getElementById('examSuggestionList');

        if (available.length === 0) {
            box.style.display = 'block';
            list.innerHTML = '<div style="color:var(--text-muted);padding:10px;">Uygun derslik bulunamadı</div>';
            return;
        }

        box.style.display = 'block';
        list.innerHTML = '';
        available.slice(0, 5).forEach(r => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `
        <div class="suggestion-info">
          <span>${r.classroom.name}</span>
          <small>${r.classroom.capacity} kişi • ${r.classroom.department ? getDepartmentName(r.classroom.department) : 'Genel'}</small>
        </div>
        <button class="btn btn-success btn-sm" onclick="document.getElementById('examClassroom').value='${r.classroom.id}'">Seç</button>
      `;
            list.appendChild(item);
        });
    }

    // ===== MANUAL SCHEDULE =====
    function manualSchedule() {
        const courseId = document.getElementById('manualCourse').value;
        const day = document.getElementById('manualDay').value;
        const startTime = document.getElementById('manualStartTime').value;
        let classroomId = document.getElementById('manualClassroom').value;

        if (!courseId) return toast('Ders seçiniz!', 'error');
        if (!startTime) return toast('Saat seçiniz!', 'error');

        const course = state.courses.find(c => c.id === courseId);
        const slot = TIME_SLOTS.find(s => s.start === startTime);
        if (!slot) return toast('Geçersiz saat!', 'error');

        // Check instructor conflict
        if (hasInstructorConflict(course.instructor, day, slot.start, slot.end)) {
            return toast(`${course.instructor} bu saatte başka bir dersi var!`, 'error');
        }

        if (!classroomId) {
            // Auto-find
            const available = findAvailableClassrooms(day, slot.start, slot.end, course.studentCount, course.department);
            if (available.length === 0) {
                return toast('Bu zaman diliminde uygun derslik bulunamadı!', 'error');
            }
            classroomId = available[0].classroom.id;
            toast(`Otomatik atandı: ${available[0].classroom.name}`, 'info');
        } else {
            if (hasConflict(classroomId, day, slot.start, slot.end)) {
                return toast('Çakışma var! Bu derslik ve saatte ders/sınav mevcut!', 'error');
            }
            // Check capacity
            const cr = state.classrooms.find(c => c.id === classroomId);
            if (cr && cr.capacity < course.studentCount) {
                return toast(`Derslik kapasitesi yetersiz! (${cr.capacity} < ${course.studentCount})`, 'warning');
            }
        }

        state.schedule.push({
            id: uid(),
            type: 'course',
            courseId,
            classroomId,
            day,
            startTime: slot.start,
            endTime: slot.end
        });

        save('schedule');
        renderSchedule();
        renderCourses();
        updateStats();
        toast(`"${course.name}" dersi ${day} ${slot.label} saatine yerleştirildi!`);
    }

    function findBestSuggestion() {
        const courseId = document.getElementById('manualCourse').value;
        const day = document.getElementById('manualDay').value;
        const startTime = document.getElementById('manualStartTime').value;

        if (!courseId) return toast('Önce ders seçiniz!', 'error');

        const course = state.courses.find(c => c.id === courseId);
        const slot = TIME_SLOTS.find(s => s.start === startTime);
        if (!slot) return;

        const available = findAvailableClassrooms(day, slot.start, slot.end, course.studentCount, course.department);

        const box = document.getElementById('scheduleSuggestions');
        const list = document.getElementById('scheduleSuggestionList');

        if (available.length === 0) {
            box.style.display = 'block';
            list.innerHTML = '<div style="color:var(--text-muted);padding:10px;">Bu zaman diliminde uygun derslik yok</div>';
            return;
        }

        box.style.display = 'block';
        list.innerHTML = '';
        available.slice(0, 5).forEach(r => {
            const item = document.createElement('div');
            item.className = 'suggestion-item';
            item.innerHTML = `
        <div class="suggestion-info">
          <span>${r.classroom.name}</span>
          <small>${r.classroom.capacity} kişi • Puan: ${r.score.toFixed(1)}</small>
        </div>
        <button class="btn btn-success btn-sm" onclick="document.getElementById('manualClassroom').value='${r.classroom.id}'">Seç</button>
      `;
            list.appendChild(item);
        });
    }

    // ===== PDF DOWNLOAD =====
    function downloadCoursePDF() {
        if (state.schedule.length === 0) {
            toast('Henüz ders yerleştirilmedi!', 'warning');
            return;
        }
        downloadSchedulePDF('course');
    }

    function downloadExamPDF() {
        if (state.exams.length === 0) {
            toast('Henüz sınav eklenmedi!', 'warning');
            return;
        }
        downloadSchedulePDF('exam');
    }

    function downloadSchedulePDF(type) {
        const viewMode = document.getElementById('scheduleView').value;
        const viewLabel = viewMode === 'weekday' ? 'Hafta İçi' : viewMode === 'weekend' ? 'Hafta Sonu' : 'Tüm Hafta';
        const now = new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });
        const title = type === 'course' ? '📚 Ders Programı' : '📝 Sınav Programı';
        const thColor = type === 'course' ? '#00b894' : '#e17055';
        const thBorder = type === 'course' ? '#00a884' : '#c0392b';

        const printHTML = `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>${type === 'course' ? 'Ders' : 'Sınav'} Programı - ${viewLabel}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #1a1a2e; font-size: 11px; }
    .pdf-header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid ${thColor}; padding-bottom: 12px; }
    .pdf-header h1 { font-size: 24px; color: ${thColor}; margin-bottom: 4px; }
    .pdf-header p { font-size: 12px; color: #666; }
    .classroom-section { margin-bottom: 24px; page-break-inside: avoid; }
    .classroom-title { font-size: 14px; font-weight: 700; color: ${thColor}; margin-bottom: 8px; padding: 6px 12px; background: ${type === 'course' ? '#e8f8f5' : '#fdecea'}; border-radius: 6px; border-left: 4px solid ${thColor}; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { padding: 8px 6px; background: ${thColor}; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid ${thBorder}; text-align: center; }
    td { padding: 5px 4px; border: 1px solid #ddd; vertical-align: top; min-height: 35px; height: 35px; text-align: center; }
    td:first-child { background: #f8f7ff; font-weight: 600; font-size: 10px; white-space: nowrap; width: 70px; }
    .event-course { background: #d4edda; border-radius: 4px; padding: 3px 5px; margin: 1px; font-size: 9px; }
    .event-course .name { font-weight: 700; color: #155724; }
    .event-course .detail { color: #28a745; font-size: 8px; }
    .event-exam { background: #f8d7da; border-radius: 4px; padding: 3px 5px; margin: 1px; font-size: 9px; border: 1px solid #f5c6cb; }
    .event-exam .name { font-weight: 700; color: #721c24; }
    .event-exam .detail { color: #c0392b; font-size: 8px; }
    .pdf-footer { text-align: center; margin-top: 20px; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
    @media print {
      body { padding: 10px; }
      .classroom-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="pdf-header">
    <h1>${title}</h1>
    <p>${viewLabel} • ${now}</p>
  </div>
  ${generatePDFContent(viewMode, type)}
  <div class="pdf-footer">${type === 'course' ? 'Ders' : 'Sınav'} Programı Yönetim Sistemi • ${now}</div>
</body>
</html>`;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            toast('Popup engelleyici açık olabilir. Lütfen izin verin.', 'error');
            return;
        }
        printWindow.document.write(printHTML);
        printWindow.document.close();
        printWindow.onload = function () {
            printWindow.print();
        };
        setTimeout(() => { printWindow.print(); }, 500);
        toast(`${type === 'course' ? 'Ders' : 'Sınav'} programı PDF penceresi açıldı. "PDF olarak kaydet" seçeneğini kullanın.`, 'info');
    }

    function generatePDFContent(viewMode, type) {
        const filterClassroom = document.getElementById('scheduleFilterClassroom').value;
        const filterDepartment = document.getElementById('scheduleFilterDepartment').value;

        let classrooms = [...state.classrooms];
        if (filterClassroom !== 'all') classrooms = classrooms.filter(c => c.id === filterClassroom);
        if (filterDepartment !== 'all') classrooms = classrooms.filter(c => c.department === filterDepartment || !c.department);

        if (classrooms.length === 0) return '<p>Gösterilecek derslik yok.</p>';

        let days = [];
        if (viewMode === 'weekday') days = DAYS_WEEKDAY;
        else if (viewMode === 'weekend') days = DAYS_WEEKEND;
        else days = ALL_DAYS;

        let html = '';

        classrooms.forEach(cr => {
            // Only show classrooms that have events of this type
            const hasEvents = type === 'course'
                ? state.schedule.some(s => s.classroomId === cr.id)
                : state.exams.some(e => e.classroomId === cr.id);
            if (!hasEvents) return;

            html += `<div class="classroom-section">`;
            html += `<div class="classroom-title">🏫 ${cr.name} (Kapasite: ${cr.capacity})</div>`;
            html += `<table><thead><tr><th>Saat</th>`;
            days.forEach(d => { html += `<th>${d}</th>`; });
            html += `</tr></thead><tbody>`;

            TIME_SLOTS.forEach(slot => {
                html += `<tr><td>${slot.start}<br>${slot.end}</td>`;
                days.forEach(day => {
                    const events = getEventsForSlotByType(cr.id, day, slot.start, slot.end, type);
                    html += '<td>';
                    events.forEach(ev => {
                        if (ev.type === 'course') {
                            const course = state.courses.find(c => c.id === ev.courseId);
                            html += `<div class="event-course"><span class="name">${course ? course.name : '?'}</span><br><span class="detail">${course ? course.instructor : ''}</span></div>`;
                        } else if (ev.type === 'exam') {
                            const course = state.courses.find(c => c.id === ev.courseId);
                            html += `<div class="event-exam"><span class="name">📝 ${course ? course.name : '?'}</span><br><span class="detail">SINAV (${ev.duration} dk)</span></div>`;
                        }
                    });
                    html += '</td>';
                });
                html += '</tr>';
            });

            html += '</tbody></table></div>';
        });

        return html;
    }

    // ===== STUDENT SCHEDULE =====
    function renderStudentSchedule() {
        const container = document.getElementById('studentScheduleContainer');
        if (!container) return;
        container.innerHTML = '';

        const departmentId = document.getElementById('studentScheduleDepartment').value;
        const yearFilter = document.getElementById('studentScheduleYear').value;
        const viewMode = document.getElementById('studentScheduleView').value;

        if (!departmentId) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎓</div><p>Lütfen bir bölüm seçiniz</p></div>';
            return;
        }

        const dept = state.departments.find(d => d.id === departmentId);
        if (!dept) return;

        const years = yearFilter === 'all' ? [1, 2, 3, 4] : [parseInt(yearFilter)];

        let days = [];
        if (viewMode === 'weekday') days = DAYS_WEEKDAY;
        else if (viewMode === 'weekend') days = DAYS_WEEKEND;
        else days = ALL_DAYS;

        years.forEach(year => {
            // Find courses for this department and year
            const coursesForYear = state.courses.filter(c => c.department === departmentId && (c.year || 1) === year);

            if (coursesForYear.length === 0) return;

            const section = document.createElement('div');
            section.style.marginBottom = '28px';

            const title = document.createElement('h3');
            title.style.cssText = 'font-size:1.1rem;font-weight:700;margin-bottom:12px;color:var(--accent-1);padding:8px 14px;background:rgba(108,92,231,0.1);border-radius:8px;border-left:4px solid var(--accent-1);';
            title.textContent = `🎓 ${dept.code} - ${dept.name} / ${year}. Sınıf`;
            section.appendChild(title);

            const wrapper = document.createElement('div');
            wrapper.className = 'schedule-wrapper';

            const table = document.createElement('table');
            table.className = 'schedule-table';

            // Header
            const thead = document.createElement('thead');
            let headerHTML = '<tr><th>Saat</th>';
            days.forEach(d => { headerHTML += `<th>${d}</th>`; });
            headerHTML += '</tr>';
            thead.innerHTML = headerHTML;
            table.appendChild(thead);

            // Body
            const tbody = document.createElement('tbody');
            TIME_SLOTS.forEach(slot => {
                const tr = document.createElement('tr');
                tr.innerHTML = `<td>${slot.start}<br><small style="opacity:0.6">${slot.end}</small></td>`;

                days.forEach(day => {
                    const td = document.createElement('td');
                    // Find scheduled courses for this year's courses in this slot
                    coursesForYear.forEach(course => {
                        state.schedule.forEach(entry => {
                            if (entry.courseId !== course.id || entry.day !== day) return;
                            const eStart = timeToMinutes(entry.startTime);
                            const eEnd = timeToMinutes(entry.endTime);
                            const sStart = timeToMinutes(slot.start);
                            const sEnd = timeToMinutes(slot.end);
                            if (sStart < eEnd && sEnd > eStart) {
                                const classroom = state.classrooms.find(cr => cr.id === entry.classroomId);
                                const chip = document.createElement('div');
                                chip.className = 'schedule-event course';
                                chip.innerHTML = `<span class="event-name">${course.name}</span><span class="event-detail">📍 ${classroom ? classroom.name : '?'}</span>`;
                                chip.title = `${course.name}\nÖğretim Görevlisi: ${course.instructor}\nDerslik: ${classroom ? classroom.name : '?'}\n${slot.label}`;
                                td.appendChild(chip);
                            }
                        });
                    });
                    tr.appendChild(td);
                });

                tbody.appendChild(tr);
            });

            table.appendChild(tbody);
            wrapper.appendChild(table);
            section.appendChild(wrapper);
            container.appendChild(section);
        });

        if (container.children.length === 0) {
            container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎓</div><p>Bu bölüm ve sınıf için yerleştirilmiş ders bulunamadı</p></div>';
        }
    }

    function downloadStudentPDF() {
        const departmentId = document.getElementById('studentScheduleDepartment').value;
        const yearFilter = document.getElementById('studentScheduleYear').value;
        const viewMode = document.getElementById('studentScheduleView').value;

        if (!departmentId) {
            toast('Lütfen bir bölüm seçiniz!', 'error');
            return;
        }

        const dept = state.departments.find(d => d.id === departmentId);
        if (!dept) return;

        const years = yearFilter === 'all' ? [1, 2, 3, 4] : [parseInt(yearFilter)];
        const viewLabel = viewMode === 'weekday' ? 'Hafta İçi' : viewMode === 'weekend' ? 'Hafta Sonu' : 'Tüm Hafta';
        const now = new Date().toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' });

        let days = [];
        if (viewMode === 'weekday') days = DAYS_WEEKDAY;
        else if (viewMode === 'weekend') days = DAYS_WEEKEND;
        else days = ALL_DAYS;

        let contentHTML = '';

        years.forEach(year => {
            const coursesForYear = state.courses.filter(c => c.department === departmentId && (c.year || 1) === year);
            if (coursesForYear.length === 0) return;

            contentHTML += `<div class="year-section">`;
            contentHTML += `<div class="year-title">🎓 ${dept.code} - ${dept.name} / ${year}. Sınıf</div>`;
            contentHTML += `<table><thead><tr><th>Saat</th>`;
            days.forEach(d => { contentHTML += `<th>${d}</th>`; });
            contentHTML += `</tr></thead><tbody>`;

            TIME_SLOTS.forEach(slot => {
                contentHTML += `<tr><td class="time-col">${slot.start}<br>${slot.end}</td>`;
                days.forEach(day => {
                    contentHTML += '<td>';
                    coursesForYear.forEach(course => {
                        state.schedule.forEach(entry => {
                            if (entry.courseId !== course.id || entry.day !== day) return;
                            const eStart = timeToMinutes(entry.startTime);
                            const eEnd = timeToMinutes(entry.endTime);
                            const sStart = timeToMinutes(slot.start);
                            const sEnd = timeToMinutes(slot.end);
                            if (sStart < eEnd && sEnd > eStart) {
                                const classroom = state.classrooms.find(cr => cr.id === entry.classroomId);
                                contentHTML += `<div class="event"><span class="course-name">${course.name}</span><br><span class="classroom-info">📍 ${classroom ? classroom.name : '?'}</span></div>`;
                            }
                        });
                    });
                    contentHTML += '</td>';
                });
                contentHTML += '</tr>';
            });

            contentHTML += '</tbody></table></div>';
        });

        if (!contentHTML) {
            toast('Bu bölüm ve sınıf için yerleştirilmiş ders bulunamadı!', 'warning');
            return;
        }

        const yearLabel = yearFilter === 'all' ? 'Tüm Sınıflar' : `${yearFilter}. Sınıf`;

        const printHTML = `
<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <title>Öğrenci Ders Programı - ${dept.code}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #1a1a2e; font-size: 11px; }
    .pdf-header { text-align: center; margin-bottom: 20px; border-bottom: 3px solid #6c5ce7; padding-bottom: 12px; }
    .pdf-header h1 { font-size: 24px; color: #6c5ce7; margin-bottom: 4px; }
    .pdf-header .subtitle { font-size: 16px; color: #333; font-weight: 600; margin-bottom: 4px; }
    .pdf-header p { font-size: 12px; color: #666; }
    .year-section { margin-bottom: 28px; page-break-inside: avoid; }
    .year-title { font-size: 15px; font-weight: 700; color: #6c5ce7; margin-bottom: 10px; padding: 8px 14px; background: #f0eeff; border-radius: 6px; border-left: 4px solid #6c5ce7; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
    th { padding: 8px 6px; background: #6c5ce7; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; border: 1px solid #5a4bd1; text-align: center; }
    td { padding: 5px 4px; border: 1px solid #ddd; vertical-align: top; min-height: 35px; height: 35px; text-align: center; }
    .time-col { background: #f8f7ff; font-weight: 600; font-size: 10px; white-space: nowrap; width: 70px; }
    .event { background: #e8f5e9; border-radius: 4px; padding: 4px 6px; margin: 2px; font-size: 9px; border: 1px solid #c8e6c9; }
    .course-name { font-weight: 700; color: #1b5e20; font-size: 10px; }
    .classroom-info { color: #e65100; font-weight: 600; font-size: 9px; }
    .instructor-section { margin-top: 24px; page-break-inside: avoid; }
    .instructor-section h3 { font-size: 14px; font-weight: 700; color: #6c5ce7; margin-bottom: 10px; padding: 6px 12px; background: #f0eeff; border-radius: 6px; border-left: 4px solid #6c5ce7; }
    .instructor-table { width: 100%; border-collapse: collapse; }
    .instructor-table th { background: #6c5ce7; color: #fff; padding: 8px 12px; text-align: left; font-size: 11px; border: 1px solid #5a4bd1; }
    .instructor-table td { padding: 7px 12px; border: 1px solid #ddd; font-size: 11px; }
    .instructor-table tr:nth-child(even) { background: #f8f7ff; }
    .pdf-footer { text-align: center; margin-top: 20px; font-size: 10px; color: #999; border-top: 1px solid #eee; padding-top: 8px; }
    @media print {
      body { padding: 10px; }
      .year-section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="pdf-header">
    <h1>🎓 Öğrenci Ders Programı</h1>
    <div class="subtitle">${dept.code} - ${dept.name} / ${yearLabel}</div>
    <p>${viewLabel} • ${now}</p>
  </div>
  ${contentHTML}
  ${generateInstructorListHTML(departmentId, years)}
  <div class="pdf-footer">Öğrenci Ders Programı • ${dept.code} - ${dept.name} • ${now}</div>
</body>
</html>`;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            toast('Popup engelleyici açık olabilir. Lütfen izin verin.', 'error');
            return;
        }
        printWindow.document.write(printHTML);
        printWindow.document.close();
        printWindow.onload = function () {
            printWindow.print();
        };
        setTimeout(() => { printWindow.print(); }, 500);
        toast('Öğrenci ders programı PDF penceresi açıldı. "PDF olarak kaydet" seçeneğini kullanın.', 'info');
    }

    function generateInstructorListHTML(departmentId, years) {
        // Collect all courses for the given department and years
        const relevantCourses = state.courses.filter(c => c.department === departmentId && years.includes(c.year || 1));
        if (relevantCourses.length === 0) return '';

        // Group by instructor
        const instructorMap = {};
        relevantCourses.forEach(c => {
            if (!instructorMap[c.instructor]) {
                instructorMap[c.instructor] = [];
            }
            instructorMap[c.instructor].push(`${c.name} (${c.year || 1}. Sınıf)`);
        });

        let html = '<div class="instructor-section">';
        html += '<h3>👨‍🏫 Öğretim Görevlileri ve Dersleri</h3>';
        html += '<table class="instructor-table"><thead><tr><th style="width:40%">Öğretim Görevlisi</th><th>Verdiği Dersler</th></tr></thead><tbody>';

        Object.keys(instructorMap).sort().forEach(instructor => {
            html += `<tr><td><strong>${instructor}</strong></td><td>${instructorMap[instructor].join(', ')}</td></tr>`;
        });

        html += '</tbody></table></div>';
        return html;
    }

    // ===== TEMPLATES =====
    function saveTemplate() {
        const name = document.getElementById('templateName').value.trim();
        const description = document.getElementById('templateDescription').value.trim();

        if (!name) return toast('Şablon adı giriniz!', 'error');

        const template = {
            id: uid(),
            name,
            description,
            date: new Date().toLocaleDateString('tr-TR'),
            data: {
                classrooms: JSON.parse(JSON.stringify(state.classrooms)),
                departments: JSON.parse(JSON.stringify(state.departments)),
                courses: JSON.parse(JSON.stringify(state.courses)),
                exams: JSON.parse(JSON.stringify(state.exams)),
                schedule: JSON.parse(JSON.stringify(state.schedule))
            }
        };

        state.templates.push(template);
        save('templates');
        renderTemplates();

        document.getElementById('templateName').value = '';
        document.getElementById('templateDescription').value = '';
        toast(`"${name}" şablonu kaydedildi!`);
    }

    function loadTemplate(id) {
        const t = state.templates.find(x => x.id === id);
        if (!t) return;

        showModal('📥 Şablon Yükle',
            `<p>"<strong>${t.name}</strong>" şablonunu yüklemek istediğinizden emin misiniz?</p><p style="color:var(--text-muted);font-size:0.85rem;">Mevcut tüm veriler bu şablonun verileriyle değiştirilecek.</p>`,
            [
                { text: 'Yükle', class: 'btn btn-success btn-sm', action: () => { forceLoadTemplate(t); closeModal(); } },
                { text: 'İptal', class: 'btn btn-primary btn-sm', action: closeModal }
            ]
        );
    }

    function forceLoadTemplate(t) {
        state.classrooms = JSON.parse(JSON.stringify(t.data.classrooms));
        state.departments = JSON.parse(JSON.stringify(t.data.departments));
        state.courses = JSON.parse(JSON.stringify(t.data.courses));
        state.exams = JSON.parse(JSON.stringify(t.data.exams));
        state.schedule = JSON.parse(JSON.stringify(t.data.schedule));

        saveAll();
        renderAll();
        toast(`"${t.name}" şablonu yüklendi!`);
    }

    function deleteTemplate(id) {
        const t = state.templates.find(x => x.id === id);
        state.templates = state.templates.filter(x => x.id !== id);
        save('templates');
        renderTemplates();
        toast(`"${t?.name}" şablonu silindi`, 'info');
    }

    function exportJSON() {
        const data = {
            classrooms: state.classrooms,
            departments: state.departments,
            courses: state.courses,
            exams: state.exams,
            schedule: state.schedule,
            exportDate: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ders-programi-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        toast('JSON dosyası indirildi!');
    }

    function importJSON() {
        document.getElementById('importFileInput').click();
    }

    function handleImportFile(e) {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function (evt) {
            try {
                const data = JSON.parse(evt.target.result);
                if (data.classrooms) state.classrooms = data.classrooms;
                if (data.departments) state.departments = data.departments;
                if (data.courses) state.courses = data.courses;
                if (data.exams) state.exams = data.exams;
                if (data.schedule) state.schedule = data.schedule;
                saveAll();
                renderAll();
                toast('Veriler başarıyla içe aktarıldı!');
            } catch (err) {
                toast('Geçersiz JSON dosyası!', 'error');
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // ===== RENDER ALL =====
    function renderAll() {
        renderClassrooms();
        renderDepartments();
        renderCourses();
        renderExams();
        renderTemplates();
        renderSchedule();
        populateDepartmentSelects();
        populateClassroomSelects();
        populateCourseSelects();
        populateTimeSlotSelects();
        updateStats();
    }

    // ===== EVENT LISTENERS =====
    function initEventListeners() {
        document.getElementById('btnAddClassroom').addEventListener('click', addClassroom);
        document.getElementById('btnAddDepartment').addEventListener('click', addDepartment);
        document.getElementById('btnAddCourse').addEventListener('click', addCourse);
        document.getElementById('btnAddExam').addEventListener('click', addExam);
        document.getElementById('btnAutoSchedule').addEventListener('click', autoSchedule);
        document.getElementById('btnDownloadCoursePDF').addEventListener('click', downloadCoursePDF);
        document.getElementById('btnDownloadExamPDF').addEventListener('click', downloadExamPDF);
        document.getElementById('btnDownloadCoursePDF2').addEventListener('click', downloadCoursePDF);
        document.getElementById('btnDownloadExamPDF2').addEventListener('click', downloadExamPDF);
        document.getElementById('btnManualSchedule').addEventListener('click', manualSchedule);
        document.getElementById('btnFindBest').addEventListener('click', findBestSuggestion);
        document.getElementById('btnSaveTemplate').addEventListener('click', saveTemplate);
        document.getElementById('btnExportJSON').addEventListener('click', exportJSON);
        document.getElementById('btnImportJSON').addEventListener('click', importJSON);
        document.getElementById('importFileInput').addEventListener('change', handleImportFile);
        document.getElementById('btnShowStudentSchedule').addEventListener('click', renderStudentSchedule);
        document.getElementById('btnDownloadStudentPDF').addEventListener('click', downloadStudentPDF);

        // Schedule filter changes
        document.getElementById('scheduleView').addEventListener('change', renderSchedule);
        document.getElementById('scheduleFilterClassroom').addEventListener('change', renderSchedule);
        document.getElementById('scheduleFilterDepartment').addEventListener('change', renderSchedule);

        // Exam suggestion trigger
        ['examCourse', 'examDay', 'examStartTime', 'examDuration'].forEach(id => {
            document.getElementById(id).addEventListener('change', showExamSuggestions);
        });

        // Modal close on overlay click
        document.getElementById('modalOverlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('modalOverlay')) closeModal();
        });

        // Enter key for forms
        document.querySelectorAll('input').forEach(input => {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const card = input.closest('.card');
                    const btn = card?.querySelector('.btn-primary, .btn-danger, .btn-success');
                    if (btn) btn.click();
                }
            });
        });
    }

    // ===== PUBLIC API (for inline onclick handlers) =====
    window.App = {
        deleteClassroom,
        deleteDepartment,
        deleteCourse,
        deleteExam,
        loadTemplate,
        deleteTemplate
    };

    // ===== INIT =====
    function init() {
        loadAll();
        initTabs();
        initEventListeners();
        renderAll();
    }

    document.addEventListener('DOMContentLoaded', init);
})();
