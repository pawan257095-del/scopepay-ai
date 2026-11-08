import { NextRequest, NextResponse } from "next/server";
import { supabaseRequest } from "@/lib/supabase-admin";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const rows = await supabaseRequest<
      {
        id: string;
        title: string;
        proposal: Record<string, unknown>;
        status: string;
        created_at: string;
        updated_at: string;
        expires_at: string;
      }[]
    >(
      `scopepay_proposals?select=id,title,proposal,status,created_at,updated_at,expires_at&id=eq.${encodeURIComponent(id)}&limit=1`
    );

    if (!rows.length) {
      return NextResponse.json(
        { error: "Proposal not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ proposal: rows[0] });
  } catch (error) {
    console.error("[ScopePay] Get proposal error:", error);

    return NextResponse.json(
      { error: "Could not load proposal." },
      { status: 500 }
    );
  }
}