document.addEventListener('DOMContentLoaded', () => {
    const generateBtn = document.getElementById('generateBtn');
    const regexInput = document.getElementById('regexInput');
    const presetRegex = document.getElementById('presetRegex');
    const errorMsg = document.getElementById('error-message');
    
    // Controls
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    const playBtn = document.getElementById('playBtn');
    const stepNumberEl = document.getElementById('stepNumber');
    const stepDescEl = document.getElementById('stepDescription');
    
    // DFA & Simulation
    const dfaBtn = document.getElementById('dfaBtn');
    const simulationBox = document.getElementById('simulation-box');
    const testBtn = document.getElementById('testBtn');
    const testStringInput = document.getElementById('testString');
    const testResultDiv = document.getElementById('testResult');

    let cy = null;
    let constructionSteps = [];
    let dfaElements = [];
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

        fetch('/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regex: regex })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                errorMsg.classList.add('hidden');
                constructionSteps = data.steps;
                dfaElements = data.dfa_elements;
                
                prevBtn.disabled = false;
                nextBtn.disabled = false;
                playBtn.disabled = false;
                dfaBtn.disabled = false;
                
                goToStep(constructionSteps.length - 1);
            } else {
                errorMsg.textContent = "Error parsing Regex. Please check your syntax.";
                errorMsg.classList.remove('hidden');
            }
        })
        .catch(err => console.error(err));
    });

    // --- DFA View Toggle Logic ---
    dfaBtn.addEventListener('click', () => {
        pausePlayback();
        if(!isDfaView) {
            // Switch to DFA
            renderGraph(dfaElements);
            isDfaView = true;
            dfaBtn.textContent = "Back to NFA Steps";
            simulationBox.classList.remove('hidden');
            
            // Disable NFA step controls
            prevBtn.disabled = true; 
            nextBtn.disabled = true; 
            playBtn.disabled = true;
        } else {
            // Switch back to NFA
            goToStep(currentStepIndex);
            isDfaView = false;
            dfaBtn.textContent = "Convert to DFA";
            simulationBox.classList.add('hidden');
            
            // Re-enable NFA step controls
            prevBtn.disabled = (currentStepIndex === 0);
            nextBtn.disabled = (currentStepIndex === constructionSteps.length - 1);
            playBtn.disabled = false;
        }
    });

    // --- Simulation Logic ---
    testBtn.addEventListener('click', () => {
        const regex = regexInput.value.trim();
        const text = testStringInput.value;
        testResultDiv.textContent = "Testing...";
        testResultDiv.style.color = "#333";

        fetch('/simulate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ regex: regex, text: text })
        })
        .then(res => res.json())
        .then(data => {
            if(data.success) {
                if(data.accepted) {
                    testResultDiv.textContent = "✅ String Accepted";
                    testResultDiv.style.color = "#2ecc71";
                } else {
                    testResultDiv.textContent = "❌ String Rejected";
                    testResultDiv.style.color = "#e74c3c";
                }
            } else {
                testResultDiv.textContent = "Error simulating string.";
                testResultDiv.style.color = "#e74c3c";
            }
        });
    });

    // --- Playback Logic ---
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
                if (currentStepIndex < constructionSteps.length - 1) {
                    goToStep(currentStepIndex + 1);
                } else {
                    pausePlayback();
                }
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

    // --- Graph Rendering ---
    function renderGraph(elements) {
        if (cy) cy.destroy();
        cy = cytoscape({
            container: document.getElementById('cy'),
            elements: elements,
            style: [
                {
                    selector: 'node',
                    style: {
                        'background-color': '#3498db', 'label': 'data(label)', 'color': '#fff',
                        'text-valign': 'center', 'text-halign': 'center', 'font-size': '12px',
                        'width': '40px', 'height': '40px'
                    }
                },
                {
                    selector: 'edge',
                    style: {
                        'width': 2, 'line-color': '#95a5a6', 'target-arrow-color': '#95a5a6',
                        'target-arrow-shape': 'triangle', 'curve-style': 'bezier', 'label': 'data(label)',
                        'font-size': '14px', 'text-background-color': '#fff', 'text-background-opacity': 1,
                        'text-margin-y': -10
                    }
                },
                { selector: '.start', style: { 'background-color': '#2ecc71', 'border-width': 3, 'border-color': '#27ae60' } },
                { selector: '.accept', style: { 'background-color': '#e74c3c', 'border-width': 4, 'border-style': 'double', 'border-color': '#c0392b' } }
            ],
            layout: {
                name: 'breadthfirst', directed: true, spacingFactor: 1.5,
                roots: cy => cy.nodes('.start').length > 0 ? cy.nodes('.start') : cy.nodes()[0]
            }
        });
    }
});