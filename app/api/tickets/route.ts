import { NextResponse } from "next/server";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";

export async function GET() {
  return NextResponse.json({
    success: true,
    total: MOCK_RAW_TICKETS.length,
    data: MOCK_RAW_TICKETS,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const newTickets = Array.isArray(body) ? body : [body];
    return NextResponse.json({
      success: true,
      message: `成功接收 ${newTickets.length} 条新工单`,
      data: newTickets,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Invalid ticket payload" },
      { status: 400 }
    );
  }
}
