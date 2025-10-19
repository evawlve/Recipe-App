import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getCurrentUser } from '@/lib/auth';

/**
 * Admin endpoint for food database statistics
 * GET /api/admin/food-stats
 */
export async function GET(req: NextRequest) {
  try {
    // Check for API key in headers or query params
    const apiKey = req.headers.get('x-api-key') || req.nextUrl.searchParams.get('api_key');
    const devApiKey = process.env.DEV_API_KEY || 'dev-key-123';
    
    // Allow API key bypass for development
    if (apiKey === devApiKey) {
      console.log('Admin access granted via API key');
    } else {
      // Fallback to user authentication
      const user = await getCurrentUser();
      if (!user?.id) {
        return NextResponse.json({ 
          error: 'Unauthorized', 
          hint: 'Use x-api-key header or api_key query param with dev key'
        }, { status: 401 });
      }

      // Check if user is admin (you can implement your own admin logic)
      // For now, just check if user exists
      const isAdmin = true; // TODO: Implement proper admin check

      if (!isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Get basic stats first
    const totalFoods = await prisma.food.count();

    // Get counts per source
    const sourceStats = await prisma.food.groupBy({
      by: ['source'],
      _count: {
        id: true
      }
    });

    // Get counts per category
    const categoryStats = await prisma.food.groupBy({
      by: ['categoryId'],
      _count: {
        id: true
      },
      where: {
        categoryId: {
          not: null
        }
      }
    });

    // Get recent additions (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentAdditions = await prisma.food.groupBy({
      by: ['source'],
      _count: {
        id: true
      },
      where: {
        createdAt: {
          gte: sevenDaysAgo
        }
      }
    });

    // Get other counts - test each one individually
    let totalUnits = 0;
    let totalAliases = 0;
    let totalBarcodes = 0;
    
    try {
      totalUnits = await prisma.foodUnit.count();
    } catch (e) {
      console.log('FoodUnit error:', e);
    }
    
    try {
      totalAliases = await prisma.foodAlias.count();
    } catch (e) {
      console.log('FoodAlias error:', e);
    }
    
    try {
      totalBarcodes = await prisma.barcode.count();
    } catch (e) {
      console.log('Barcode error:', e);
    }

    // Get top categories
    const topCategories = await prisma.food.groupBy({
      by: ['categoryId'],
      _count: {
        id: true
      },
      where: {
        categoryId: {
          not: null
        }
      },
      orderBy: {
        _count: {
          id: 'desc'
        }
      },
      take: 10
    });

    // Get verification stats
    const verificationStats = await prisma.food.groupBy({
      by: ['verification'],
      _count: {
        id: true
      }
    });

    const stats = {
      totals: {
        foods: totalFoods,
        units: totalUnits,
        aliases: totalAliases,
        barcodes: totalBarcodes
      },
      sources: sourceStats.map(s => ({
        source: s.source,
        count: s._count.id
      })),
      categories: categoryStats.map(c => ({
        categoryId: c.categoryId,
        count: c._count.id
      })),
      recentAdditions: recentAdditions.map(r => ({
        source: r.source,
        count: r._count.id
      })),
      topCategories: topCategories.map(t => ({
        categoryId: t.categoryId,
        count: t._count.id
      })),
      verification: verificationStats.map(v => ({
        verification: v.verification,
        count: v._count.id
      }))
    };

    return NextResponse.json({
      success: true,
      data: stats
    });

  } catch (error) {
    console.error('Admin food stats error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to get food statistics',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
