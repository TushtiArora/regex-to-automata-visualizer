// --- Core Automata Logic ---

let stateIdCounter = 0;

class State {
    constructor() {
        this.id = stateIdCounter++;
        this.transitions = {}; // { symbol: [State1, State2] }
        this.is_start = false;
        this.is_accept = false;
    }
}

class NFA {
    constructor(start, accept) {
        this.start = start;
        this.accept = accept;
    }
}

function insertExplicitConcat(regex) {
    let result = "";
    for (let i = 0; i < regex.length; i++) {
        let c1 = regex[i];
        result += c1;
        if (i + 1 < regex.length) {
            let c2 = regex[i + 1];
            if (!['|', '('].includes(c1) && !['|', '*', ')'].includes(c2)) {
                result += '.';
            }
        }
    }
    return result;
}

function toPostfix(regex) {
    const precedence = { '*': 3, '.': 2, '|': 1 };
    let output = [];
    let stack = [];
    for (let char of regex) {
        if (/[a-zA-Z0-9]/.test(char)) {
            output.push(char);
        } else if (char === '(') {
            stack.push(char);
        } else if (char === ')') {
            while (stack.length > 0 && stack[stack.length - 1] !== '(') {
                output.push(stack.pop());
            }
            stack.pop();
        } else {
            while (stack.length > 0 && stack[stack.length - 1] !== '(' && (precedence[stack[stack.length - 1]] || 0) >= (precedence[char] || 0)) {
                output.push(stack.pop());
            }
            stack.push(char);
        }
    }
    while (stack.length > 0) output.push(stack.pop());
    return output.join('');
}

function snapshotStack(nfaStack) {
    let elements = [];
    let visited = new Set();
    
    for (let partialNfa of nfaStack) {
        let queue = [partialNfa.start];
        while (queue.length > 0) {
            let current = queue.shift();
            if (visited.has(current.id)) continue;
            visited.add(current.id);
            
            let classes = [];
            if (current === partialNfa.start) classes.push('start');
            if (current === partialNfa.accept) classes.push('accept');
            
            elements.push({ data: { id: `q${current.id}`, label: `q${current.id}` }, classes: classes.join(' ') });
            
            for (let [symbol, targets] of Object.entries(current.transitions)) {
                for (let target of targets) {
                    elements.push({ data: { source: `q${current.id}`, target: `q${target.id}`, label: symbol } });
                    if (!visited.has(target.id)) queue.push(target);
                }
            }
        }
    }
    return elements;
}

function buildNFAWithSteps(postfix) {
    stateIdCounter = 0;
    let stack = [];
    let steps = [];
    
    for (let index = 0; index < postfix.length; index++) {
        let char = postfix[index];
        let desc = "";
        
        if (/[a-zA-Z0-9]/.test(char)) {
            let s0 = new State(), s1 = new State();
            s0.transitions[char] = [s1];
            stack.push(new NFA(s0, s1));
            desc = `Literal '${char}': Created a new transition.`;
        } else if (char === '.') {
            let nfa2 = stack.pop(), nfa1 = stack.pop();
            nfa1.accept.transitions['ε'] = [nfa2.start];
            stack.push(new NFA(nfa1.start, nfa2.accept));
            desc = `Concatenation: Linked components with an ε-transition.`;
        } else if (char === '|') {
            let nfa2 = stack.pop(), nfa1 = stack.pop();
            let s0 = new State(), s3 = new State();
            s0.transitions['ε'] = [nfa1.start, nfa2.start];
            nfa1.accept.transitions['ε'] = [s3];
            nfa2.accept.transitions['ε'] = [s3];
            stack.push(new NFA(s0, s3));
            desc = `Union (|): Created branching paths.`;
        } else if (char === '*') {
            let nfa = stack.pop();
            let s0 = new State(), s1 = new State();
            s0.transitions['ε'] = [nfa.start, s1];
            nfa.accept.transitions['ε'] = [nfa.start, s1];
            stack.push(new NFA(s0, s1));
            desc = `Kleene Star (*): Added looping/bypass ε-transitions.`;
        }
        steps.push({ step_num: index + 1, char_processed: char, description: desc, elements: snapshotStack(stack) });
    }
    
    let finalNfa = stack.pop();
    finalNfa.start.is_start = true;
    finalNfa.accept.is_accept = true;
    steps[steps.length - 1].elements = snapshotStack([finalNfa]);
    return { steps, finalNfa };
}

// DFA Conversion
let dfaStateIdCounter = 0;
class DFAState {
    constructor(nfaStatesSet) {
        this.id = dfaStateIdCounter++;
        this.nfaStates = nfaStatesSet; // Set of NFA States
        this.transitions = {};
        this.is_start = false;
        this.is_accept = false;
    }
}

function getEpsilonClosure(states) {
    let closure = new Set(states);
    let stack = [...states];
    while (stack.length > 0) {
        let s = stack.pop();
        if (s.transitions['ε']) {
            for (let t of s.transitions['ε']) {
                if (!closure.has(t)) {
                    closure.add(t);
                    stack.push(t);
                }
            }
        }
    }
    return closure;
}

function nfaToDFA(nfa) {
    dfaStateIdCounter = 0;
    let alphabet = new Set();
    let visited = new Set();
    let q = [nfa.start];
    
    // Discover alphabet
    while (q.length > 0) {
        let curr = q.shift();
        if (visited.has(curr.id)) continue;
        visited.add(curr.id);
        for (let [sym, targets] of Object.entries(curr.transitions)) {
            if (sym !== 'ε') alphabet.add(sym);
            for (let t of targets) {
                if (!visited.has(t.id)) q.push(t);
            }
        }
    }

    let startClosure = getEpsilonClosure([nfa.start]);
    let dfaStart = new DFAState(startClosure);
    dfaStart.is_start = true;
    if ([...startClosure].some(s => s.is_accept)) dfaStart.is_accept = true;
    
    let dfaStates = [dfaStart];
    let unmarked = [dfaStart];
    
    // Create string keys for Sets to use in state map
    const getSetKey = set => [...set].map(s => s.id).sort((a,b)=>a-b).join(',');
    let stateMap = {};
    stateMap[getSetKey(startClosure)] = dfaStart;
    
    while (unmarked.length > 0) {
        let currDfa = unmarked.shift();
        for (let sym of alphabet) {
            let moveSet = new Set();
            for (let nfa_s of currDfa.nfaStates) {
                if (nfa_s.transitions[sym]) {
                    nfa_s.transitions[sym].forEach(t => moveSet.add(t));
                }
            }
            if (moveSet.size === 0) continue;
            
            let closureSet = getEpsilonClosure(moveSet);
            let closureKey = getSetKey(closureSet);
            
            if (!stateMap[closureKey]) {
                let newDfa = new DFAState(closureSet);
                if ([...closureSet].some(s => s.is_accept)) newDfa.is_accept = true;
                stateMap[closureKey] = newDfa;
                dfaStates.push(newDfa);
                unmarked.push(newDfa);
            }
            currDfa.transitions[sym] = stateMap[closureKey];
        }
    }
    return { start: dfaStart, states: dfaStates };
}

function dfaToCytoscapeJson(dfa) {
    let elements = [];
    for (let state of dfa.states) {
        let classes = [];
        if (state.is_start) classes.push('start');
        if (state.is_accept) classes.push('accept');
        elements.push({ data: { id: `d${state.id}`, label: `D${state.id}` }, classes: classes.join(' ') });
        
        let edgeMap = {};
        for (let [sym, target] of Object.entries(state.transitions)) {
            if (!edgeMap[target.id]) edgeMap[target.id] = [];
            edgeMap[target.id].push(sym);
        }
        for (let [targetId, symbols] of Object.entries(edgeMap)) {
            elements.push({ data: { source: `d${state.id}`, target: `d${targetId}`, label: symbols.join(', ') } });
        }
    }
    return elements;
}

function simulateStringOnDFA(dfa, text) {
    let curr = dfa.start;
    for (let char of text) {
        if (curr.transitions[char]) {
            curr = curr.transitions[char];
        } else {
            return false;
        }
    }
    return curr.is_accept;
}

// --- UI Interaction Logic ---
document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const regexInput = document.getElementById('regexInput');
    const presetRegex = document.getElementById('presetRegex');
    const errorMsg = document.getElementById('error-message');
    
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const playBtn = document.getElementById('playBtn');
    const stepNumberEl = document.getElementById('stepNumber');
    const stepDescEl = document.getElementById('stepDescription');
    
    const dfaBtn = document.getElementById('dfaBtn');
    const simulationBox = document.getElementById('simulation-box');
    const testBtn = document.getElementById('testBtn');
    const testStringInput = document.getElementById('testString');
    const testResultDiv = document.getElementById('testResult');

    let cy = null;
    let constructionSteps = [];
    let dfaElements = [];
    let generatedDfa = null;
    let currentStepIndex = -1;
    let playInterval = null;
    let isDfaView = false;

    presetRegex.addEventListener('change', (e) => {
        if(e.target.value) regexInput.value = e.target.value;
    });

    generateBtn.addEventListener('click', () => {
        const regex = regexInput.value.trim();
        if (!regex) return;

        pausePlayback();
        isDfaView = false;
        dfaBtn.textContent = "Convert to DFA";
        simulationBox.classList.add('hidden');
        testResultDiv.textContent = "";

        try {
            let regexConcat = insertExplicitConcat(regex);
            let postfix = toPostfix(regexConcat);
            let result = buildNFAWithSteps(postfix);
            
            constructionSteps = result.steps;
            generatedDfa = nfaToDFA(result.finalNfa);
            dfaElements = dfaToCytoscapeJson(generatedDfa);
            
            errorMsg.classList.add('hidden');
            prevBtn.disabled = false;
            nextBtn.disabled = false;
            playBtn.disabled = false;
            dfaBtn.disabled = false;
            
            goToStep(constructionSteps.length - 1);
        } catch (e) {
            console.error(e);
            errorMsg.textContent = "Error parsing Regex. Please check your syntax.";
            errorMsg.classList.remove('hidden');
        }
    });

    dfaBtn.addEventListener('click', () => {
        pausePlayback();
        if(!isDfaView) {
            renderGraph(dfaElements);
            isDfaView = true;
            dfaBtn.textContent = "Back to NFA Steps";
            simulationBox.classList.remove('hidden');
            prevBtn.disabled = true; 
            nextBtn.disabled = true; 
            playBtn.disabled = true;
        } else {
            goToStep(currentStepIndex);
            isDfaView = false;
            dfaBtn.textContent = "Convert to DFA";
            simulationBox.classList.add('hidden');
            prevBtn.disabled = (currentStepIndex === 0);
            nextBtn.disabled = (currentStepIndex === constructionSteps.length - 1);
            playBtn.disabled = false;
        }
    });

    testBtn.addEventListener('click', () => {
        const text = testStringInput.value;
        if(simulateStringOnDFA(generatedDfa, text)) {
            testResultDiv.textContent = "✅ String Accepted";
            testResultDiv.style.color = "#2ecc71";
        } else {
            testResultDiv.textContent = "❌ String Rejected";
            testResultDiv.style.color = "#e74c3c";
        }
    });

    function goToStep(index) {
        if (index < 0 || index >= constructionSteps.length) return;
        currentStepIndex = index;
        const stepData = constructionSteps[index];
        
        stepNumberEl.textContent = `Step ${stepData.step_num} / ${constructionSteps.length} ('${stepData.char_processed}')`;
        stepDescEl.textContent = stepData.description;
        renderGraph(stepData.elements);

        prevBtn.disabled = (currentStepIndex === 0);
        nextBtn.disabled = (currentStepIndex === constructionSteps.length - 1);
    }

    prevBtn.addEventListener('click', () => { pausePlayback(); goToStep(currentStepIndex - 1); });
    nextBtn.addEventListener('click', () => { pausePlayback(); goToStep(currentStepIndex + 1); });

    playBtn.addEventListener('click', () => {
        if (playInterval) {
            pausePlayback();
        } else {
            if (currentStepIndex === constructionSteps.length - 1) goToStep(0);
            playBtn.textContent = "Pause";
            playInterval = setInterval(() => {
                if (currentStepIndex < constructionSteps.length - 1) goToStep(currentStepIndex + 1);
                else pausePlayback();
            }, 1000);
        }
    });

    function pausePlayback() {
        if (playInterval) {
            clearInterval(playInterval);
            playInterval = null;
        }
        playBtn.textContent = "Play All";
    }

    function renderGraph(elements) {
        if (cy) cy.destroy();
        cy = cytoscape({
            container: document.getElementById('cy'),
            elements: elements,
            style: [
                { selector: 'node', style: { 'background-color': '#3498db', 'label': 'data(label)', 'color': '#fff', 'text-valign': 'center', 'text-halign': 'center', 'font-size': '12px', 'width': '40px', 'height': '40px' } },
                { selector: 'edge', style: { 'width': 2, 'line-color': '#95a5a6', 'target-arrow-color': '#95a5a6', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'label': 'data(label)', 'font-size': '14px', 'text-background-color': '#fff', 'text-background-opacity': 1, 'text-margin-y': -10 } },
                { selector: '.start', style: { 'background-color': '#2ecc71', 'border-width': 3, 'border-color': '#27ae60' } },
                { selector: '.accept', style: { 'background-color': '#e74c3c', 'border-width': 4, 'border-style': 'double', 'border-color': '#c0392b' } }
            ],
            layout: { name: 'breadthfirst', directed: true, spacingFactor: 1.5, roots: cy => cy.nodes('.start').length > 0 ? cy.nodes('.start') : cy.nodes()[0] }
        });
    }
});