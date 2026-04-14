from flask import Flask, render_template, request, jsonify

app = Flask(__name__)

# --- NFA Structures ---
class State:
    _id = 0
    def __init__(self):
        self.id = State._id
        State._id += 1
        self.transitions = {} 
        self.is_start = False
        self.is_accept = False

class NFA:
    def __init__(self, start, accept):
        self.start = start
        self.accept = accept

# --- DFA Structures ---
class DFAState:
    _id = 0
    def __init__(self, nfa_states):
        self.id = DFAState._id
        DFAState._id += 1
        self.nfa_states = frozenset(nfa_states)
        self.transitions = {} 
        self.is_start = False
        self.is_accept = False

class DFA:
    def __init__(self, start, states):
        self.start = start
        self.states = states

# --- Parsing Logic ---
def insert_explicit_concat(regex):
    result = ""
    for i in range(len(regex)):
        c1 = regex[i]
        result += c1
        if i + 1 < len(regex):
            c2 = regex[i+1]
            if (c1 not in ['|', '(']) and (c2 not in ['|', '*', ')']):
                result += '.'
    return result

def to_postfix(regex):
    precedence = {'*': 3, '.': 2, '|': 1}
    output, stack = [], []
    for char in regex:
        if char.isalnum(): output.append(char)
        elif char == '(': stack.append(char)
        elif char == ')':
            while stack and stack[-1] != '(': output.append(stack.pop())
            stack.pop()
        else:
            while stack and stack[-1] != '(' and precedence.get(stack[-1], 0) >= precedence.get(char, 0):
                output.append(stack.pop())
            stack.append(char)
    while stack: output.append(stack.pop())
    return "".join(output)

# --- NFA Building ---
def snapshot_stack(nfa_stack):
    elements = []
    visited = set()
    for partial_nfa in nfa_stack:
        queue = [partial_nfa.start]
        while queue:
            current = queue.pop(0)
            if current.id in visited: continue
            visited.add(current.id)
            
            classes = []
            if current == partial_nfa.start: classes.append('start')
            if current == partial_nfa.accept: classes.append('accept')
            
            elements.append({"data": {"id": str(current.id), "label": f"q{current.id}"}, "classes": " ".join(classes)})
            for symbol, targets in current.transitions.items():
                for target in targets:
                    elements.append({"data": {"source": str(current.id), "target": str(target.id), "label": symbol}})
                    if target.id not in visited: queue.append(target)
    return elements

def build_nfa_with_steps(postfix):
    State._id = 0 
    stack = []
    steps = []
    for index, char in enumerate(postfix):
        desc = ""
        if char.isalnum():
            s0, s1 = State(), State()
            s0.transitions[char] = [s1]
            stack.append(NFA(s0, s1))
            desc = f"Literal '{char}': Created a new transition."
        elif char == '.':
            nfa2, nfa1 = stack.pop(), stack.pop()
            nfa1.accept.transitions['ε'] = [nfa2.start]
            stack.append(NFA(nfa1.start, nfa2.accept))
            desc = f"Concatenation: Linked components with an ε-transition."
        elif char == '|':
            nfa2, nfa1 = stack.pop(), stack.pop()
            s0, s3 = State(), State()
            s0.transitions['ε'] = [nfa1.start, nfa2.start]
            nfa1.accept.transitions['ε'] = [s3]
            nfa2.accept.transitions['ε'] = [s3]
            stack.append(NFA(s0, s3))
            desc = f"Union (|): Created branching paths."
        elif char == '*':
            nfa = stack.pop()
            s0, s1 = State(), State()
            s0.transitions['ε'] = [nfa.start, s1]
            nfa.accept.transitions['ε'] = [nfa.start, s1]
            stack.append(NFA(s0, s1))
            desc = f"Kleene Star (*): Added looping/bypass ε-transitions."
            
        steps.append({"step_num": index + 1, "char_processed": char, "description": desc, "elements": snapshot_stack(stack)})
    
    final_nfa = stack.pop()
    final_nfa.start.is_start = True
    final_nfa.accept.is_accept = True
    # Ensure final snapshot reflects correct start/accept markers
    steps[-1]["elements"] = snapshot_stack([final_nfa])
    return steps, final_nfa

# --- DFA Subset Construction ---
def get_epsilon_closure(states):
    closure = set(states)
    stack = list(states)
    while stack:
        s = stack.pop()
        if 'ε' in s.transitions:
            for t in s.transitions['ε']:
                if t not in closure:
                    closure.add(t)
                    stack.append(t)
    return closure

def nfa_to_dfa(nfa):
    DFAState._id = 0
    alphabet = set()
    visited = set()
    q = [nfa.start]
    
    # 1. Discover alphabet
    while q:
        curr = q.pop(0)
        if curr.id in visited: continue
        visited.add(curr.id)
        for sym, targets in curr.transitions.items():
            if sym != 'ε': alphabet.add(sym)
            for t in targets:
                if t.id not in visited: q.append(t)
                
    # 2. Initialize subset construction
    start_closure = get_epsilon_closure({nfa.start})
    dfa_start = DFAState(start_closure)
    dfa_start.is_start = True
    if any(s.is_accept for s in start_closure): dfa_start.is_accept = True
    
    dfa_states = [dfa_start]
    unmarked = [dfa_start]
    state_map = {frozenset(s.id for s in start_closure): dfa_start}
    
    # 3. Process states
    while unmarked:
        curr_dfa = unmarked.pop(0)
        for sym in alphabet:
            move_set = set()
            for nfa_s in curr_dfa.nfa_states:
                if sym in nfa_s.transitions:
                    move_set.update(nfa_s.transitions[sym])
            if not move_set: continue
            
            closure_set = get_epsilon_closure(move_set)
            closure_ids = frozenset(s.id for s in closure_set)
            
            if closure_ids not in state_map:
                new_dfa = DFAState(closure_set)
                if any(s.is_accept for s in closure_set): new_dfa.is_accept = True
                state_map[closure_ids] = new_dfa
                dfa_states.append(new_dfa)
                unmarked.append(new_dfa)
                
            curr_dfa.transitions[sym] = state_map[closure_ids]
            
    return DFA(dfa_start, dfa_states)

def dfa_to_cytoscape_json(dfa):
    elements = []
    for state in dfa.states:
        classes = []
        if state.is_start: classes.append('start')
        if state.is_accept: classes.append('accept')
        elements.append({"data": {"id": f"d{state.id}", "label": f"D{state.id}"}, "classes": " ".join(classes)})
        
        # Combine labels for edges pointing to the same target to clean up the graph
        edge_map = {}
        for sym, target in state.transitions.items():
            if target.id not in edge_map: edge_map[target.id] = []
            edge_map[target.id].append(sym)
            
        for target_id, symbols in edge_map.items():
            elements.append({"data": {"source": f"d{state.id}", "target": f"d{target_id}", "label": ", ".join(symbols)}})
    return elements

def simulate_string_on_dfa(dfa, text):
    curr = dfa.start
    for char in text:
        if char in curr.transitions:
            curr = curr.transitions[char]
        else:
            return False # Dead state / No transition
    return curr.is_accept

# --- Endpoints ---
@app.route('/')
def index():
    return render_template('index.html')

@app.route('/convert', methods=['POST'])
def convert():
    data = request.json
    regex = data.get('regex', '')
    try:
        regex_concat = insert_explicit_concat(regex)
        postfix = to_postfix(regex_concat)
        steps, final_nfa = build_nfa_with_steps(postfix)
        
        # Build DFA automatically for the frontend to hold
        dfa = nfa_to_dfa(final_nfa)
        dfa_elements = dfa_to_cytoscape_json(dfa)
        
        return jsonify({"success": True, "steps": steps, "dfa_elements": dfa_elements})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

@app.route('/simulate', methods=['POST'])
def simulate():
    data = request.json
    regex = data.get('regex', '')
    text = data.get('text', '')
    try:
        postfix = to_postfix(insert_explicit_concat(regex))
        _, final_nfa = build_nfa_with_steps(postfix)
        dfa = nfa_to_dfa(final_nfa)
        result = simulate_string_on_dfa(dfa, text)
        return jsonify({"success": True, "accepted": result})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)})

if __name__ == '__main__':
    app.run(debug=True)