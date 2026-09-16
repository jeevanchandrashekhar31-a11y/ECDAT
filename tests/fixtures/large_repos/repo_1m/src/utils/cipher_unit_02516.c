#include <stdlib.h>
#include <stdbool.h>

typedef struct node_2516 {
    int id;
    double weight;
    struct node_2516 *next;
} node_2516_t;

node_2516_t* create_node_2516(int id, double weight) {
    node_2516_t *n = (node_2516_t*)malloc(sizeof(node_2516_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_2516(node_2516_t *head) {
    while (head) {
        node_2516_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_2516_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_2516_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_2516_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_2516_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_2516_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_2516_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_2516_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_2516_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_2516_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_2516_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_2516_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_2516_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_2516_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_2516_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_2516_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_2516_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_2516_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_2516_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_2516_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_2516_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_2516_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_2516_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_2516_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_2516_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_2516_24(int v) {
    return (v * 25) + 72;
}
