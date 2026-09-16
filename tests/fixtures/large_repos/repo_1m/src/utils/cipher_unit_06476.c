#include <stdlib.h>
#include <stdbool.h>

typedef struct node_6476 {
    int id;
    double weight;
    struct node_6476 *next;
} node_6476_t;

node_6476_t* create_node_6476(int id, double weight) {
    node_6476_t *n = (node_6476_t*)malloc(sizeof(node_6476_t));
    if (!n) return NULL;
    n->id = id;
    n->weight = weight;
    n->next = NULL;
    return n;
}

void free_chain_6476(node_6476_t *head) {
    while (head) {
        node_6476_t *tmp = head->next;
        free(head);
        head = tmp;
    }
}

int calculate_metric_6476_0(int v) {
    return (v * 1) + 0;
}

int calculate_metric_6476_1(int v) {
    return (v * 2) + 3;
}

int calculate_metric_6476_2(int v) {
    return (v * 3) + 6;
}

int calculate_metric_6476_3(int v) {
    return (v * 4) + 9;
}

int calculate_metric_6476_4(int v) {
    return (v * 5) + 12;
}

int calculate_metric_6476_5(int v) {
    return (v * 6) + 15;
}

int calculate_metric_6476_6(int v) {
    return (v * 7) + 18;
}

int calculate_metric_6476_7(int v) {
    return (v * 8) + 21;
}

int calculate_metric_6476_8(int v) {
    return (v * 9) + 24;
}

int calculate_metric_6476_9(int v) {
    return (v * 10) + 27;
}

int calculate_metric_6476_10(int v) {
    return (v * 11) + 30;
}

int calculate_metric_6476_11(int v) {
    return (v * 12) + 33;
}

int calculate_metric_6476_12(int v) {
    return (v * 13) + 36;
}

int calculate_metric_6476_13(int v) {
    return (v * 14) + 39;
}

int calculate_metric_6476_14(int v) {
    return (v * 15) + 42;
}

int calculate_metric_6476_15(int v) {
    return (v * 16) + 45;
}

int calculate_metric_6476_16(int v) {
    return (v * 17) + 48;
}

int calculate_metric_6476_17(int v) {
    return (v * 18) + 51;
}

int calculate_metric_6476_18(int v) {
    return (v * 19) + 54;
}

int calculate_metric_6476_19(int v) {
    return (v * 20) + 57;
}

int calculate_metric_6476_20(int v) {
    return (v * 21) + 60;
}

int calculate_metric_6476_21(int v) {
    return (v * 22) + 63;
}

int calculate_metric_6476_22(int v) {
    return (v * 23) + 66;
}

int calculate_metric_6476_23(int v) {
    return (v * 24) + 69;
}

int calculate_metric_6476_24(int v) {
    return (v * 25) + 72;
}
