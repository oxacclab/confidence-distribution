"use strict";

// TODO: centre on canvas in x dimension
// TODO: yInt adjustment?
// TODO: y cap needs to accommodate AUC adjustment
// TODO: accommodate AUC adjustment into y mouse detection
// TODO: display payout
// TODO: highlight hovered option
// TODO: widget label style options
// TODO: callback for drawing x axis options or customisable function
// TODO: allow reversed x axis values (e.g. 60 to -60)


class Distribution {
    /**
     * @constructor
     *
     * Distribution allows the generation of probability distributions (using the normal distribution)
     * on the basis of a specified (x,y) coordinate giving the probability density at the mean
     * (the distribution is symmetrical).
     *
     * The distributions allow for a form of spread betting on a range of possible answers. The range of
     * widths (standard deviations) allowed can be specified using min/maxPrecision, and the distribution
     * is scaled to respect that value to avoid unnecessary whitespace.
     *
     * Betting values can be included. Betting values start with the minimum bet for the minimum precision
     * and increase linearly until the maximum bet is reached at the maximum precision.
     *
     * Probability distributions are draw to the supplied canvas object.
     *
     * Various styling options are available through the style object.
     *
     * @param args {{}}
     * @param args.canvas {HTMLElement} - canvas on which to draw the distribution
     * @param [args.xMin = 0] {number} - x axis minimum
     * @param [args.xMax = 100] {number} - x axis maximum
     * @param [args.reverseX = false] {boolean} - whether to reverse x axis labels
     * @param [args.minPrecision = .0] {number} - minimum distribution precision (between 0 and 1)
     * @param [args.maxPrecision = 1.0] {number} - maximum distribution precision (between 0 and 1)
     * @param [args.minBet = .0] {number} - minimum bet amount allowed. Assigned to minPrecision.
     * @param [args.maxBet = 1.0] {number} - maximum bet allowed. Assigned to maxPrecision.
     *
     * @param [args.constantAUC = true] {boolean} - whether to increase inbounds values where parts of
     * the distribution are outside of the limits of the x axis.
     *
     * @param [args.style = {}] {{}} - styling options. Default to Distribution.defaultStyle.
     *
     * @return {Distribution}
     */
    constructor(args) {
        this.canvas = typeof args.canvas === "undefined"? null : args.canvas;
        this.xMin = typeof args.xMin === "undefined"? 0 : args.xMin;
        this.xMax = typeof args.xMax === "undefined"? 100 : args.xMax;
        this.reverseX = typeof args.reverseX === "undefined"? false : args.reverseX;
        this.minPrecision = typeof args.minPrecision === "undefined"? .10 : args.minPrecision;
        this.maxPrecision = typeof args.maxPrecision === "undefined"? .9 : args.maxPrecision;
        this.minBet = typeof args.minBet === "undefined"? .50 : args.minBet;
        this.maxBet = typeof args.maxBet === "undefined"? .99 : args.maxBet;

        this.constantAUC = typeof args.constantAUC === "undefined"? true : args.constantAUC;

        this.style = Distribution.defaultStyle;
        if(typeof args.style !== "undefined")
            Object.keys(args.style).forEach((k)=>this.style[k] = args.style[k]);

        // cartesian coordinates
        this.x = [];
        for(let i = 0; i <= this.xMax - this.xMin; i++)
            this.x[i] = i - (this.xMax - this.xMin)/2;
        if(this.reverseX) {
            this.x = this.x.reverse();
        }
        this.y = [];

        // betting coordinates
        this.bet = {
            yRaw: 0, // y coordinate as a proportion of available y-space
            proportion: 0, // bet as a proportion of available precision space
            amount: this.minBet,
            on: this.xMin + (this.xMax - this.xMin)
        };

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
     * Default style options.
     */
    static get defaultStyle() {
        return {
            padding: {
                x: 0,
                y: 0
            },
            widgetSize: 5,
        };
    }

    /**
     * Avoids numerous recalculations of a square root
     * @return {number} - Math.sqrt(2 * Math.PI)
     */
    static get root2pi() {
        return 2.5066282746310002;
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
        const z = 1 / (Distribution.root2pi * sd);
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
        // This can probably just be -(mean of the y values)!
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
     * @return {number} the standardized height of the graph used for interpreting y values and cursor position
     */
    get proportionalSpaceY() {
        let AUC = 0;
        if(this.constantAUC) {
            // Needs an adjustment term to account for constant AUC
            // ...
        }
        return(this.maxPrecision + this.style.padding.y + AUC);
    }

    /**
     * Number of pixels for each cartesian point
     * @return {{x: number, y: number}}
     */
    get pixelsPerPoint() {
        return {
            x: Distribution.getPixelRatio(this.x.length, this.canvas.clientWidth).ratio,
            y: Distribution.getPixelRatio(this.proportionalSpaceY,
                this.canvas.clientHeight).ratio // y axis 0:maxPrecision
        };
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
            x: 0,
            y: 0
        };
        for(let i = 0; i < this.x.length; i++) {
            let out = this.pointToDrawPoint({x: i, y: Math.round(this.y[i]*100)/100}, offset, maxY);
            this.drawPoints.x[i] = out.x + this.pixelsPerPoint.x/2;
            this.drawPoints.y[i] = out.y;
        }

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
        cursor.y = cursor.y <= 0? 1 : cursor.y > this.canvas.clientHeight? this.canvas.clientHeight : cursor.y;

        // y as proportion of space available
        this.bet.yRaw = (cursor.y * (this.proportionalSpaceY)) / (this.canvas.clientHeight);

        // Clamp by allowed precision range
        this.bet.yRaw = this.bet.yRaw < this.minPrecision?
            this.minPrecision : this.bet.yRaw > this.maxPrecision?
                this.maxPrecision : this.bet.yRaw;
        
        this.bet.proportion = (this.bet.yRaw - this.minPrecision) / (this.maxPrecision - this.minPrecision);

        // desired bet amount is proportion of the betting space available
        this.bet.amount = this.minBet + this.bet.proportion * (this.maxBet - this.minBet);
        // desired mean is the x equivalent value of the mouse x coordinate
        this.bet.index = Math.floor(cursor.x / this.canvas.clientWidth * this.x.length);
        this.bet.on = this.x[this.bet.index];

        return this;
    }

    /**
     * Generate new y values for a given mean and precision
     *
     * @return Distribution - return self for chaining
     */
    updateY() {
        // Y-values need to be scaled to the x-axis range
        let range = (this.xMax - this.xMin);
        let muY = this.bet.yRaw / range * 100;

        // sd has to be such that the highest y value should be muY
        // This can be obtained by rearranging the normal distribution formula for x = mode(x)
        let sd = 1 / (Distribution.root2pi * muY);

        // Calculate the y values
        this.yRaw = Distribution.f(this.x, this.bet.on, sd);

        // Adjust y values for cases where the distribution has portions which are out-of-range
        if(this.constantAUC) {
            // Remainder is the absolute difference of tail areas
            let remainder = 0;
            for(let i = 0; i < this.x.length; i++) {
                if(this.x[i] < this.bet.on)
                    remainder += this.yRaw[i];
                if(this.x[i] > this.bet.on)
                    remainder -= this.yRaw[i];
            }
            remainder = Math.abs(remainder);
            if(remainder/this.x.length !== 0) {
                // increase each y value proportionately to its current value
                let sum = utils.sum(this.yRaw);
                for(let i = 0; i < this.yRaw.length; i++) {
                    this.yRaw[i] += remainder * (this.yRaw[i] / sum);
                }
            }
        }

        // Scale resulting y values to match x axis range
        // let range = this.xMax - this.xMin;
        for(let i = 0; i < this.yRaw.length; i++)
            this.y[i] = this.yRaw[i] * range / 100
        // this.y = this.yRaw

        this.yInt = Distribution.findIntercept(this.y);

        this.drawPoints.yInt = this.pointToDrawPoint(
            {x: 0, y: this.yInt},
            {x: 0, y: 0},
            this.canvas.clientHeight)
            .y;

        //this.yInt = this.canvas.clientHeight/2;

        return this;
    }

    drawToCanvas(clickEvent) {
        // console.log('-----------------')

        if(clickEvent === null)
            return console.log('No click event sent to drawToCanvas');
        if(this.canvas === null) // TODO: better check for canvas usability. Move to constructor?
            return console.log('No canvas defined for drawToCanvas');

        this.updateFromCursor(clickEvent)
            .updateY()
            .recalculateDrawPoints();

        let ctx = this.canvas.getContext('2d');

        // clear canvas
        ctx.clearRect(0,0,this.canvas.clientWidth, this.canvas.clientHeight);

        // rectangles
        ctx.lineWidth = this.pixelsPerPoint.x / 4;
        let strokeStyle = {
            low: ctx.lineWidth <= 1? 'red' : 'white',
            high: ctx.lineWidth <= 1? 'lightblue' : 'white'
        };

        this.drawPoints.x = utils.add(this.drawPoints.x, -this.pixelsPerPoint.x/2); // centering
        for(let i = 1; i < this.drawPoints.y.length; i++) {
            ctx.beginPath();
            if(this.drawPoints.y[i] >= this.canvas.clientHeight) {
                ctx.rect(this.drawPoints.x[i],
                    this.canvas.clientHeight/2,
                    this.pixelsPerPoint.x,
                    this.drawPoints.y[i] - this.canvas.clientHeight);
                ctx.strokeStyle = strokeStyle.low;
                ctx.fillStyle = 'red';

            }
            else {
                ctx.rect(this.drawPoints.x[i],
                    this.drawPoints.y[i],
                    this.pixelsPerPoint.x,
                    this.canvas.clientHeight - this.drawPoints.y[i]);
                ctx.strokeStyle = strokeStyle.high;
                ctx.fillStyle = 'lightblue';
            }
            ctx.fill();
            ctx.stroke();
        }

        // x Axis
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, this.canvas.clientHeight);
        ctx.lineTo(this.canvas.clientWidth, this.canvas.clientHeight);
        ctx.strokeStyle = 'black';
        ctx.stroke();

        let i = this.x.indexOf(this.bet.on);
        let muCentre = {
            x: this.drawPoints.x[i] + this.pixelsPerPoint.x/2,
            y: this.drawPoints.y[i]
        };
        this.drawWidget(muCentre);

        return this;
    }

    /**
     * Draw the moving widget
     * @param centre {{x: number, y: number}} coordinates for the widget's centre
     */
    drawWidget(centre) {
        let ctx = this.canvas.getContext('2d');

        ctx.beginPath();
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.arc(centre.x, centre.y, this.style.widgetSize, 0, 2 * Math.PI);
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        this.labelWidget(centre);

        return this;
    }

    labelWidget(widgetPosition) {
        let bet = this.bet.amount;

        let label = {
            text: "$" + (Math.round(bet*100)/100).toString() + " on " + (this.bet.on).toString(),
            font: '14px Arial',
            left: widgetPosition.x + this.style.widgetSize*2,
            width: 100,
            top: widgetPosition.y + this.style.widgetSize,
            height: 10
        };

        if(label.left + label.width > this.canvas.clientWidth)
            label.left -= label.width;

        if(label.top < label.height * 2)
            label.top = label.height * 2;
        if(label.top > this.canvas.clientHeight - label.height)
            label.top = this.canvas.clientHeight - label.height;

        let ctx = this.canvas.getContext('2d');
        ctx.font = label.font;
        ctx.strokeText(label.text, label.left, label.top);

        return this;
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