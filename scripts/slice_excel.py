#!/usr/bin/env python3
"""
Excel 文件裁剪脚本 (Python 版本)
使用方式:
    python3 scripts/slice_excel.py "/path/to/file.xlsx" 200
"""

import sys
import os
import json

def main():
    default_path = os.environ.get("EXCEL_INPUT_PATH", os.path.join(os.getcwd(), "input", "tickets.xlsx"))
    input_path = sys.argv[1] if len(sys.argv) > 1 else default_path
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 200

    print("=" * 45)
    print(f"📦 正在处理 Excel 文件: {input_path}")
    print(f"✂️ 截取行数: 前 {limit} 行")
    print("=" * 45)

    if not os.path.exists(input_path):
        print(f"❌ 文件不存在: {input_path}")
        sys.exit(1)

    try:
        import pandas as pd
        print("⏳ 使用 pandas 读取前 N 行...")
        df = pd.read_excel(input_path, nrows=limit)
        
        output_dir = os.path.join(os.getcwd(), "output")
        os.makedirs(output_dir, exist_ok=True)
        
        out_xlsx = os.path.join(output_dir, f"sample_{limit}.xlsx")
        out_csv = os.path.join(output_dir, f"sample_{limit}.csv")
        out_json = os.path.join(output_dir, f"sample_{limit}.json")
        
        df.to_excel(out_xlsx, index=False)
        df.to_csv(out_csv, index=False, encoding="utf-8-sig")
        df.to_json(out_json, orient="records", force_ascii=False, indent=2)
        
        print(f"✅ 已成功输出 Excel: {out_xlsx}")
        print(f"✅ 已成功输出 CSV:   {out_csv}")
        print(f"✅ 已成功输出 JSON:  {out_json}")
        print("\n🎉 处理完成！")
    except ImportError:
        print("⚠️ 未检测到 pandas，推荐使用 Node.js 脚本执行: pnpm run slice")

if __name__ == "__main__":
    main()
