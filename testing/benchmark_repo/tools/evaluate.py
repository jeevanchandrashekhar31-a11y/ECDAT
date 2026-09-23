#!/usr/bin/env python3
import json,sys
from pathlib import Path

def main():
    if len(sys.argv)!=3:
        print("Usage: evaluate.py expected_inventory.json detected_assets.json");sys.exit(2)
    expected=json.loads(Path(sys.argv[1]).read_text())['assets']
    detected=json.loads(Path(sys.argv[2]).read_text())
    # detected format: {"assets":[{"asset_id":...}]} or a list
    detected=detected.get('assets',detected)
    exp={x['asset_id']:x for x in expected if x['expected_detection']}
    got={x['asset_id']:x for x in detected}
    tp=len(set(exp)&set(got));fn=len(set(exp)-set(got));fp=len(set(got)-set(exp))
    p=tp/(tp+fp) if tp+fp else 0;r=tp/(tp+fn) if tp+fn else 0;f=2*p*r/(p+r) if p+r else 0
    print(json.dumps({'expected_positive':len(exp),'detected':len(got),'true_positive':tp,'false_negative':fn,'false_positive':fp,'precision':round(p,4),'recall':round(r,4),'f1':round(f,4)},indent=2))
    print('Missing:',sorted(set(exp)-set(got)))
    print('Unexpected:',sorted(set(got)-set(exp)))
if __name__=='__main__': main()
