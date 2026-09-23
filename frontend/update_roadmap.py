import sys

file_path = 'src/pages/Roadmap.tsx'
try:
    with open(file_path, 'r', encoding='utf-8') as f:
        code = f.read()

    # Make the roadmap header print better
    code = code.replace('print:border-b-2 print:border-slate-400', 'print:border-b-2 print:border-slate-800 print:pb-6 print:mb-6')

    # Enhance the Notice box
    code = code.replace('print:border-slate-300 print:bg-slate-50', 'print:border-amber-500/50 print:bg-amber-50/50 print:shadow-sm')

    # Make the steps grid 2-column or 3-column in print to save space but still be readable
    code = code.replace('<div className="grid grid-cols-1 md:grid-cols-5 gap-3">', '<div className="grid grid-cols-1 md:grid-cols-5 print:grid-cols-2 gap-4 print:gap-6">')

    # Improve the recommendation cards for print
    code = code.replace('print:border-slate-300 print:bg-white print:break-inside-avoid print:shadow-sm print:mb-4', 'print:border-slate-300 print:bg-white print:break-inside-avoid print:shadow-md print:rounded-xl print:p-8')
    code = code.replace('print:border-slate-300 print:bg-white print:break-inside-avoid', 'print:border-slate-300 print:bg-white print:break-inside-avoid print:shadow-md print:rounded-xl print:p-8')

    # Ensure priority badges look good on print
    code = code.replace('bg-rose-950/70 text-rose-300 border border-rose-800/60', 'bg-rose-950/70 text-rose-300 border border-rose-800/60 print:bg-rose-100 print:text-rose-800 print:border-rose-300')
    code = code.replace('bg-amber-950/70 text-amber-300 border border-amber-800/60', 'bg-amber-950/70 text-amber-300 border border-amber-800/60 print:bg-amber-100 print:text-amber-800 print:border-amber-300')
    code = code.replace('bg-purple-950/70 text-purple-300 border border-purple-800/60', 'bg-purple-950/70 text-purple-300 border border-purple-800/60 print:bg-purple-100 print:text-purple-800 print:border-purple-300')

    with open(file_path, 'w', encoding='utf-8') as f:
        f.write(code)
    print('Updated Roadmap.tsx print styles')
except Exception as e:
    print(f'Error: {e}')
