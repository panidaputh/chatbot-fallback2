// src/services/shippingCalculator.js
const { getThaiTime } = require("./timeService");

/**
 * คำนวณปริมาตรเชิงการค้า (CBM)
 * @param {number} width - ความกว้าง (ซม.)
 * @param {number} length - ความยาว (ซม.)
 * @param {number} height - ความสูง (ซม.)
 * @returns {number} ปริมาตรเป็น CBM
 */
function calculateCBM(width, length, height) {
  return (width * length * height) / 1000000;
}

/**
 * กำหนด Rank ตามยอดสะสม
 * @param {number} accumulatedAmount - ยอดสะสมการสั่งซื้อ (บาท)
 * @returns {string} Rank ของลูกค้า
 */
function determineRank(accumulatedAmount) {
  if (accumulatedAmount > 2000000) return "STAR";
  if (accumulatedAmount > 500000) return "DIAMOND";
  return "SILVER";
}

/**
 * ดึงอัตราค่าขนส่งตาม Rank และประเภทสินค้า
 * @param {string} rank - Rank ของลูกค้า
 * @param {string} productType - ประเภทสินค้า ('general', 'type1-2', 'special')
 * @param {string} shippingMethod - วิธีการขนส่ง ('land', 'sea')
 * @returns {Object} อัตราค่าขนส่งต่อ กก. และ CBM
 */
function getShippingRate(rank, productType, shippingMethod) {
  const rates = {
    SILVER: {
      land: {
        general: { perKg: 50, perCBM: 7500 },
        'type1-2': { perKg: 60, perCBM: 8500 },
        special: { perKg: 120, perCBM: 12000 }
      },
      sea: {
        general: { perKg: 45, perCBM: 5400 },
        'type1-2': { perKg: 50, perCBM: 6900 },
        special: { perKg: 120, perCBM: 12000 }
      }
    },
    DIAMOND: {
      land: {
        general: { perKg: 45, perCBM: 7300 },
        'type1-2': { perKg: 55, perCBM: 8300 },
        special: { perKg: 110, perCBM: 11000 }
      },
      sea: {
        general: { perKg: 40, perCBM: 4900 },
        'type1-2': { perKg: 50, perCBM: 6500 },
        special: { perKg: 110, perCBM: 11000 }
      }
    },
    STAR: {
      land: {
        general: { perKg: 40, perCBM: 6800 },
        'type1-2': { perKg: 50, perCBM: 7800 },
        special: { perKg: 100, perCBM: 10000 }
      },
      sea: {
        general: { perKg: 35, perCBM: 4500 },
        'type1-2': { perKg: 45, perCBM: 6300 },
        special: { perKg: 100, perCBM: 10000 }
      }
    }
  };

  return rates[rank][shippingMethod][productType];
}

/**
 * คำนวณค่าขนส่งสุทธิ
 * @param {number} weight - น้ำหนักจริง (กก.)
 * @param {number} cbm - ปริมาตรเชิงการค้า (CBM)
 * @param {Object} rate - อัตราค่าขนส่ง
 * @returns {Object} ค่าขนส่งและวิธีการคำนวณที่ใช้
 */
function calculateShippingFee(weight, cbm, rate) {
  const volumetricFee = cbm * rate.perCBM;
  const weightFee = weight * rate.perKg;

  return {
    fee: Math.max(volumetricFee, weightFee),
    method: volumetricFee > weightFee ? 'CBM' : 'WEIGHT'
  };
}

/**
 * ฟังก์ชันจัดการ Intent สำหรับคำนวณค่าขนส่ง
 * @param {DialogflowAgent} agent - Dialogflow agent
 * @param {FirebaseDatabase} db - Firebase database instance
 */
async function handleShippingCalculation(agent, db) {
  try {
    // รับพารามิเตอร์จาก Dialogflow
    const {
      width,
      length,
      height,
      weight,
      productType = 'general',
      shippingMethod = 'land',
      accumulatedAmount = 0
    } = agent.parameters;

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!width || !length || !height || !weight) {
      agent.add("กรุณาระบุข้อมูลให้ครบถ้วน (กว้าง x ยาว x สูง และน้ำหนัก)");
      return;
    }

    // คำนวณค่าต่างๆ
    const cbm = calculateCBM(width, length, height);
    const rank = determineRank(accumulatedAmount);
    const rate = getShippingRate(rank, productType, shippingMethod);
    const { fee, method } = calculateShippingFee(weight, cbm, rate);

    // บันทึกข้อมูลการคำนวณ
    const userId = agent.originalRequest?.payload?.data?.source?.userId || "unknown";
    const calculationRef = db.ref(`shipping_calculations/${userId}`);
    await calculationRef.push({
      timestamp: getThaiTime().toISOString(),
      dimensions: { width, length, height },
      weight,
      cbm,
      productType,
      shippingMethod,
      rank,
      fee,
      calculationMethod: method
    });

    // สร้างข้อความตอบกลับ
    const response = 
      `🚚 ผลการคำนวณค่าขนส่ง:\n\n` +
      `📦 ขนาด: ${width}x${length}x${height} ซม.\n` +
      `⚖️ น้ำหนัก: ${weight} กก.\n` +
      `📊 ปริมาตร: ${cbm.toFixed(3)} CBM\n` +
      `🏆 Rank: ${rank} Rabbit\n` +
      `💰 ค่าขนส่ง: ${fee.toFixed(2)} บาท\n` +
      `ℹ️ คิดตาม: ${method === 'CBM' ? 'ปริมาตร' : 'น้ำหนัก'}`;

    agent.add(response);
  } catch (error) {
    console.error("❌ Error in handleShippingCalculation:", error);
    agent.add("ขออภัย เกิดข้อผิดพลาดในการคำนวณ กรุณาลองใหม่อีกครั้ง");
  }
}

module.exports = {
  calculateCBM,
  determineRank,
  getShippingRate,
  calculateShippingFee,
  handleShippingCalculation
};