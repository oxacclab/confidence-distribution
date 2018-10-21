"use strict";

class Distribution {
    /**
     * @constructor
     */
    constructor(args) {
        this.canvas = typeof args.canvas === "undefined"? null : args.canvas;
        this.xMax = typeof args.xMax === "undefined"? null : args.xMax;
        this.xMin = typeof args.xMin === "undefined"? null : args.xMin;
        this.minPrecision = typeof args.minPrecision === "undefined"? .7 : args.minPrecision;
        this.maxPrecision = typeof args.maxPrecision === "undefined"? .995 : args.maxPrecision;

        this.widgetSize = typeof args.widgetSize === "undefined"? 5 : args.widgetSize;

        // cartesian coordinates
        this.x = [];
        for(let i = 0; i < this.xMax - this.xMin; i++)
            this.x[i] = i - (this.xMax - this.xMin)/2;
        this.y = [];

        // graphics coordinates
        this.drawPoints = {x: [], y: [], yInt: 0};

        this.canvas.distribution = this;
        this.canvas.drawToCanvas = function(event) {
            this.distribution.drawToCanvas(event);
        };
        this.canvas.trackMouse = function(enable = true) {
            if(enable)
                this.addEventListener('mousemove', this.drawToCanvas);
            else
                this.removeEventListener('mousemove', this.drawToCanvas);
        };
        this.canvas.addEventListener('mousedown', (event)=>{
            this.canvas.trackMouse();
            this.drawToCanvas(event)
        });
        this.canvas.addEventListener('mouseup', ()=>this.canvas.trackMouse(false));
        this.canvas.addEventListener('mouseout', ()=>this.canvas.trackMouse(false));

        return this;
    }

    /**
     * Return f(x) which is the frequency of x in the normal distribution
     * @param x {number[]} base score
     * @param mu {number} mean of the normal distribution
     * @param sd {number} standard deviation of the normal distribution
     * @return {number[]} resulting f(x) values
     */
    static f(x, mu, sd) {
        let y = [];
        const z = 1/(Math.sqrt(2*Math.PI)*sd);
        const w = Math.pow(2*sd, 2);
        for(let i = 0; i < x.length; i++) {
            // normal distribution
            y[i] = z * Math.exp(-(Math.pow(x[i] - mu,2) / w));
        }
        return y;
    }

    /**
     * Find the value z for which the sum of values in y is closest to 0
     * @param y {number[]}
     * @return {number}
     */
    static findIntercept(y) {
        let error = Infinity;
        let newError = Infinity;
        let z = 0;
        let yNew = [];
        for(let i = utils.getMin(y);
            i < utils.getMax(y);
            i += (utils.getMax(y)-utils.getMin(y)) / y.length) {
            yNew = utils.add(y, -i);
            newError = Math.abs(utils.sum(yNew));
            if(newError < error) {
                error = newError;
                z = i;
            }
        }
        return z;
    }

    /**
     * Return the drawPoint from a cartesian point
     * @param point {{x: number, y: number}} cartesian point coordinates
     * @param offset {{x: number, y: number}} offsets for each dimension
     * @param maxY {number} height of the y axis
     * @return {{x: number, y: number}} drawing coordinates
     */
    pointToDrawPoint(point, offset, maxY) {
        return {
            x: (point.x - offset.x) * this.pixelsPerPoint.x,
            y: maxY - (point.y + offset.y)*this.pixelsPerPoint.y
        };
    }

    /**
     * Calculate drawPoints from cartesian points
     * @return Distribution - return self for chaining
     */
    recalculateDrawPoints() {
        let maxY = this.canvas.clientHeight;
        let offset = {
            x: utils.getMin(this.x),
            y: 100
        };
        for(let i = 0; i < this.x.length; i++) {
            let out = this.pointToDrawPoint({x: this.x[i], y: this.y[i]}, offset, maxY);
            this.drawPoints.x[i] = out.x;
            this.drawPoints.y[i] = out.y;
        }

        return this;
    }

    /**
     * Find the maximum number of pixels assignable to each point, and the number of pixels left over
     * @param points {int} number of points required
     * @param pixels {int} number of pixels available
     * @return {{ratio: number, remainder: number}}
     */
    static getPixelRatio(points, pixels) {
        let ratio = Math.floor(pixels / points);
        let remainder = pixels - (ratio * points);
        return {ratio, remainder};
    }

    /**
     * Number of pixels for each cartesian point
     * @return {{x: number, y: number}}
     */
    get pixelsPerPoint() {
        return {
            x: Distribution.getPixelRatio(this.x.length, this.canvas.clientWidth).ratio,
            y: Distribution.getPixelRatio(200, this.canvas.clientHeight).ratio // fixed y axis -1:1 by 0.01
        };
    }

    /**
     * Generate new y values for a given mean and precision
     *
     * @return Distribution - return self for chaining
     */
    updateY() {
        // Calculate the y values
        let sd = (1 - this.precision) * (utils.getMax(this.x) - utils.getMin(this.x)); // scale sd to x axis
        this.y = Distribution.f(this.x, this.mu, sd);
        // scale y values to between 1 and -1
        let max = utils.getMax(this.y);
        for(let i = 0; i < this.y.length; i++)
            this.y[i] = this.precision * this.y[i] * 100 / max;

        this.yInt = Distribution.findIntercept(this.y);

        this.drawPoints.yInt = this.pointToDrawPoint(
            {x: 0, y: this.yInt},
            {x: 0, y: 100},
            this.canvas.clientHeight)
            .y;

        //this.yInt = this.canvas.clientHeight/2;

        return this;
    }

    getCursorCoordinates(clickEvent) {
        let x = clickEvent.clientX - this.canvas.getBoundingClientRect().left - this.canvas.clientLeft;
        let y = clickEvent.clientY - this.canvas.getBoundingClientRect().top - this.canvas.clientTop;

        // save raw cursor position
        this.cursorPosition = {x, y};

        // reverse y coordinate to handle graphics using reversed y axis
        y = this.canvas.clientHeight - y;

        return {x, y};
    }

    /**
     * Calculate the mean and precision as a function of the cursor position
     * @return {Distribution} - return self for chaining
     */
    updateFromCursor(clickEvent) {
        let cursor = this.getCursorCoordinates(clickEvent);

        // cap the cursor coordinates
        cursor.x = cursor.x < 0? 0 : cursor.x >= this.canvas.clientWidth? this.canvas.clientWidth-1 : cursor.x;
        cursor.y = cursor.y < this.canvas.clientHeight/2?
            this.canvas.clientHeight/2 : cursor.y > this.canvas.clientHeight?
                this.canvas.clientHeight : cursor.y;

        // desired mean is the x equivalent value of the mouse x coordinate
        let mu = this.x[Math.floor(cursor.x / this.canvas.clientWidth * this.x.length)];
        // precision is the position in the y dimension between max and min precision limits
        let limits = this.getDistributionLimitPoints(mu);
        let precision = (cursor.y - limits.high) / (limits.high - limits.low);
        console.log('----')
        console.log(mu)
        console.log(limits)
        console.log(cursor.y)
        // input precision is bolstered by the minimum precision to prevent overly flat curves
        precision = this.minPrecision + (precision * (1-this.minPrecision));
        precision = precision > this.maxPrecision? this.maxPrecision : precision;

        this.mu = mu;
        this.precision = precision;

        return this;
    }

    drawToCanvas(clickEvent) {
        if(clickEvent === null)
            return console.log('No click event sent to drawToCanvas');
        if(this.canvas === null) // TODO: better check for canvas usability
            return console.log('No canvas defined for drawToCanvas');

        this.updateFromCursor(clickEvent)
            .updateY()
            .recalculateDrawPoints();

        let ctx = this.canvas.getContext('2d');

        // clear canvas
        ctx.clearRect(0,0,this.canvas.clientWidth, this.canvas.clientHeight);

        // shift the y values so the intercept is in the middle of the canvas
        this.drawPoints.y = utils.add(this.drawPoints.y, this.canvas.clientHeight/2 - this.drawPoints.yInt);

        // rectangles
        ctx.fillStyle = 'lightblue';
        ctx.fill();
        ctx.strokeStyle = 'white';
        ctx.lineWidth = 2;
        this.drawPoints.x = utils.add(this.drawPoints.x, -this.pixelsPerPoint.x/2); // centering
        for(let i = 1; i < this.drawPoints.y.length; i++) {
            ctx.beginPath();
            if(this.drawPoints.y[i] >= this.canvas.clientHeight/2) {
                ctx.rect(this.drawPoints.x[i],
                    this.canvas.clientHeight/2,
                    this.pixelsPerPoint.x,
                    this.drawPoints.y[i] - this.canvas.clientHeight/2);
                ctx.fillStyle = 'red';
            }
            else {
                ctx.rect(this.drawPoints.x[i],
                    this.drawPoints.y[i],
                    this.pixelsPerPoint.x,
                    this.canvas.clientHeight/2 - this.drawPoints.y[i]);
                ctx.fillStyle = 'lightblue';
            }
            ctx.fill();
            ctx.stroke();
        }

        // x Axis
        ctx.beginPath();
        ctx.moveTo(0, this.canvas.clientHeight/2);
        ctx.lineTo(this.canvas.clientWidth, this.canvas.clientHeight/2);
        ctx.strokeStyle = 'black';
        ctx.stroke();

        let i = this.x.indexOf(this.mu);
        let muCentre = {
            x: this.drawPoints.x[i] + this.pixelsPerPoint.x/2,
            y: this.drawPoints.y[i]
        };
        console.log(muCentre)
        this.drawWidget(muCentre);

        // TODO: add payout annotation
        // TODO: correct x offset (clikcing far right means x is undefined)
        // TODO: more intuitive vertical widget movement

        return this;
    }

    /**
     * Return the theoretical limits of the confidence distribution
     * @return {{low: number[], high: number[]}}
     */
    getDistributionLimits(mu = null) {
        if(mu === null) // use midpoint as mean
            mu = this.xMin + (this.xMax - this.xMin)/2;
        return {
            low: Distribution.f([mu], mu, this.minPrecision)[0],
            high: Distribution.f([mu], mu, this.maxPrecision)[0]
        }
    }

    getDistributionLimitPoints() {
        let limits = this.getDistributionLimits(this.mu);
        limits.low = this.pointToDrawPoint({x:0, y: limits.low * 100}, {x: 0, y: 100}, this.canvas.clientHeight/2).y;
        limits.low = -limits.low - this.canvas.clientTop;
        limits.high = this.pointToDrawPoint({x:0, y: limits.high * 100}, {x: 0, y: 100}, this.canvas.clientHeight/2).y;
        limits.high = this.canvas.clientHeight/2 + limits.high;

        return limits;
    }

    /**
     * Draw the moving widget
     * @param centre {{x: number, y: number}} coordinates for the widget's centre
     */
    drawWidget(centre) {
        let ctx = this.canvas.getContext('2d');

        let limits = this.getDistributionLimitPoints();
        ctx.beginPath();
        ctx.moveTo(0, limits.high);
        ctx.lineTo(this.canvas.clientWidth, limits.high);
        ctx.strokeStyle = 'red';
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, limits.low);
        ctx.lineTo(this.canvas.clientWidth, limits.low);
        ctx.strokeStyle = 'blue';
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(centre.x, centre.y, this.widgetSize, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'black';
        ctx.fillStyle = 'white';
        ctx.fill();
        ctx.stroke();
    }
}

class utils {
    /**
     * Find the minimum value in arr[]
     * @param arr {number[]}
     * @return {number}
     */
    static getMin(arr) {
        return(arr.reduce((a,b)=>Math.min(a,b)));
    }

    /**
     * Find the maximum value in arr[]
     * @param arr {number[]}
     * @return {number}
     */
    static getMax(arr) {
        return(arr.reduce((a,b)=>Math.max(a,b)));
    }

    /**
     * Add val to each element of arr
     * @param arr {number[]}
     * @param val {number}
     * @return {number[]}
     */
    static add(arr, val) {
        let newArr = [];
        for(let i = 0; i < arr.length; i++)
            newArr[i] = arr[i] + val;
        return newArr;
    }

    /**
     * Return the sum of elements in arr
     * @param arr {number[]}
     * @return {number}
     */
    static sum(arr) {
        let total = 0;
        for(let i = 0; i < arr.length; i++)
            total += arr[i];
        return total;
    }
}

export {Distribution};